use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};

use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[tauri::command]
fn export_document_package(
    document_path: String,
    content: String,
    destination_path: String,
) -> Result<(), String> {
    let document = Path::new(&document_path);
    let document_name = document
        .file_name()
        .ok_or_else(|| "无法取得文档文件名。".to_string())?
        .to_string_lossy()
        .to_string();
    let parent = document
        .parent()
        .ok_or_else(|| "无法取得文档所在目录。".to_string())?;
    let output = File::create(destination_path).map_err(|error| error.to_string())?;
    let mut archive = ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    archive
        .start_file(document_name, options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;

    let assets = parent.join("assets");
    if assets.is_dir() {
        for entry in WalkDir::new(&assets).into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }

            let relative_path = entry
                .path()
                .strip_prefix(parent)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            archive
                .start_file(relative_path, options)
                .map_err(|error| error.to_string())?;
            let mut source = File::open(entry.path()).map_err(|error| error.to_string())?;
            let mut bytes = Vec::new();
            source
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            archive
                .write_all(&bytes)
                .map_err(|error| error.to_string())?;
        }
    }

    archive.finish().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // persisted-scope 必须在 fs 之后，才能跨重启恢复对话框授予的目录权限。
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![export_document_package])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
