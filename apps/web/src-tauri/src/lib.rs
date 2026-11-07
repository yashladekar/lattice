use tauri::Manager;

#[cfg(desktop)]
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;

#[cfg(desktop)]
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let about = AboutMetadata {
    name: Some("Lattice".into()),
    version: Some(env!("CARGO_PKG_VERSION").into()),
    ..Default::default()
  };

  let app_menu = Submenu::with_items(
    app,
    "Lattice",
    true,
    &[
      &PredefinedMenuItem::about(app, None, Some(about))?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::hide(app, None)?,
      &PredefinedMenuItem::hide_others(app, None)?,
      &PredefinedMenuItem::show_all(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::quit(app, None)?,
    ],
  )?;

  let edit_menu = Submenu::with_items(
    app,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(app, None)?,
      &PredefinedMenuItem::redo(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, None)?,
      &PredefinedMenuItem::copy(app, None)?,
      &PredefinedMenuItem::paste(app, None)?,
      &PredefinedMenuItem::select_all(app, None)?,
    ],
  )?;

  let view_menu = Submenu::with_items(
    app,
    "View",
    true,
    &[&PredefinedMenuItem::fullscreen(app, None)?],
  )?;

  let window_menu = Submenu::with_items(
    app,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(app, None)?,
      &PredefinedMenuItem::close_window(app, None)?,
    ],
  )?;

  Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

#[cfg(desktop)]
fn setup_desktop(app: &mut tauri::App) -> tauri::Result<()> {
  let handle = app.handle();

  app.set_menu(build_menu(handle)?)?;

  let show = MenuItem::with_id(handle, "show", "Open Lattice", true, None::<&str>)?;
  let quit = MenuItem::with_id(handle, "quit", "Quit Lattice", true, None::<&str>)?;
  let tray_menu = Menu::with_items(handle, &[&show, &quit])?;

  let mut tray = TrayIconBuilder::new()
    .menu(&tray_menu)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
          let _ = window.set_focus();
        }
      }
      "quit" => app.exit(0),
      _ => {}
    });

  if let Some(icon) = app.default_window_icon() {
    tray = tray.icon(icon.clone());
  }

  tray.build(handle)?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .max_file_size(5_000_000)
        .build(),
    )
    .on_window_event(|window, event| {
      #[cfg(desktop)]
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // Closing hides to the tray; Quit from the tray or the app menu exits.
        api.prevent_close();
        let _ = window.hide();
      }
      #[cfg(not(desktop))]
      let _ = (window, event);
    });

  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_window_state::Builder::default().build());

  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
        setup_desktop(app)?;

        #[cfg(any(target_os = "linux", target_os = "windows"))]
        {
          use tauri_plugin_deep_link::DeepLinkExt;
          // Best-effort: the bundle installer normally registers the scheme.
          let _ = app.deep_link().register("lattice");
        }
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
