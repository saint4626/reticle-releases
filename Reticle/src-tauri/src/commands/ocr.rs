use serde::Serialize;
#[cfg(all(target_os = "windows", feature = "ppocr"))]
use std::path::PathBuf;
#[cfg(all(target_os = "windows", feature = "ppocr"))]
use tauri::Manager;
use tauri::{command, AppHandle};

#[derive(Serialize)]
pub struct OcrWordBox {
    text: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Serialize)]
pub struct OcrResult {
    text: String,
    words: Vec<OcrWordBox>,
}

#[cfg(target_os = "windows")]
#[command]
pub fn ocr_image(app: AppHandle, bytes: Vec<u8>, engine: Option<String>) -> Result<OcrResult, String> {
    match engine.as_deref() {
        Some("ppocr_v5") => ppocr_ocr_dispatch(&app, &bytes),
        _ => windows_native_ocr(&bytes),
    }
}

#[cfg(all(target_os = "windows", feature = "ppocr"))]
fn ppocr_ocr_dispatch(app: &AppHandle, bytes: &[u8]) -> Result<OcrResult, String> {
    ppocr_ocr(app, bytes)
}

#[cfg(all(target_os = "windows", not(feature = "ppocr")))]
fn ppocr_ocr_dispatch(_app: &AppHandle, _bytes: &[u8]) -> Result<OcrResult, String> {
    Err("PP-OCRv5 backend is unavailable in this build. Rebuild with Cargo feature 'ppocr' and ensure cmake is installed.".to_string())
}

#[cfg(target_os = "windows")]
fn windows_native_ocr(bytes: &[u8]) -> Result<OcrResult, String> {
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let stream = InMemoryRandomAccessStream::new().map_err(|e| e.to_string())?;
    let output_stream = stream.GetOutputStreamAt(0).map_err(|e| e.to_string())?;
    let writer = DataWriter::CreateDataWriter(&output_stream).map_err(|e| e.to_string())?;
    writer.WriteBytes(bytes).map_err(|e| e.to_string())?;
    pollster::block_on(writer.StoreAsync().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    pollster::block_on(writer.FlushAsync().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let _ = writer.DetachStream();

    stream.Seek(0).map_err(|e| e.to_string())?;
    let decoder = pollster::block_on(BitmapDecoder::CreateAsync(&stream).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let bitmap = pollster::block_on(decoder.GetSoftwareBitmapAsync().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| e.to_string())?;
    let result = pollster::block_on(engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    let text = result.Text().map_err(|e| e.to_string())?.to_string();
    let lines = result.Lines().map_err(|e| e.to_string())?;

    let mut words = Vec::new();
    for line_index in 0..lines.Size().map_err(|e| e.to_string())? {
        let line = lines.GetAt(line_index).map_err(|e| e.to_string())?;
        let line_words = line.Words().map_err(|e| e.to_string())?;
        for word_index in 0..line_words.Size().map_err(|e| e.to_string())? {
            let word = line_words.GetAt(word_index).map_err(|e| e.to_string())?;
            let rect = word.BoundingRect().map_err(|e| e.to_string())?;
            words.push(OcrWordBox {
                text: word.Text().map_err(|e| e.to_string())?.to_string(),
                x: rect.X,
                y: rect.Y,
                width: rect.Width,
                height: rect.Height,
            });
        }
    }

    Ok(OcrResult { text, words })
}

#[cfg(all(target_os = "windows", feature = "ppocr"))]
fn ppocr_ocr(app: &AppHandle, bytes: &[u8]) -> Result<OcrResult, String> {
    use ocr_rs::OcrEngine;

    let det_model = resolve_model_path(app, "PP-OCRv5_mobile_det.mnn")?;
    let rec_model = resolve_model_path(app, "eslav_PP-OCRv5_mobile_rec_infer.mnn")?;
    let charset = resolve_model_path(app, "ppocr_keys_eslav.txt")?;

    let engine = OcrEngine::new(
        det_model
            .to_str()
            .ok_or_else(|| "Invalid det model path".to_string())?,
        rec_model
            .to_str()
            .ok_or_else(|| "Invalid rec model path".to_string())?,
        charset
            .to_str()
            .ok_or_else(|| "Invalid charset path".to_string())?,
        None,
    )
    .map_err(|e| format!("Failed to init PP-OCRv5 engine: {}", e))?;

    let image = image::load_from_memory(bytes).map_err(|e| format!("Failed to decode image: {}", e))?;
    let results = engine
        .recognize(&image)
        .map_err(|e| format!("PP-OCRv5 recognition failed: {}", e))?;

    let mut words = Vec::new();
    let mut text_lines = Vec::new();
    for result in results {
        let rect = result.bbox.rect;
        words.push(OcrWordBox {
            text: result.text.clone(),
            x: rect.left() as f32,
            y: rect.top() as f32,
            width: rect.width() as f32,
            height: rect.height() as f32,
        });
        if !result.text.trim().is_empty() {
            text_lines.push(result.text);
        }
    }

    Ok(OcrResult {
        text: text_lines.join("\n"),
        words,
    })
}

#[cfg(all(target_os = "windows", feature = "ppocr"))]
fn resolve_model_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ocr").join("ppocrv5").join(file_name));
        candidates.push(
            resource_dir
                .join("resources")
                .join("ocr")
                .join("ppocrv5")
                .join(file_name),
        );
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ocr")
            .join("ppocrv5")
            .join(file_name),
    );

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("ocr")
                .join("ppocrv5")
                .join(file_name),
        );
        candidates.push(
            cwd.join("resources")
                .join("ocr")
                .join("ppocrv5")
                .join(file_name),
        );
    }

    if let Some(found) = candidates.iter().find(|p| p.exists()) {
        return Ok(found.clone());
    }

    let tried = candidates
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("\n");
    Err(format!(
        "PP-OCRv5 model file '{}' not found. Checked:\n{}",
        file_name, tried
    ))
}

#[cfg(not(target_os = "windows"))]
#[command]
pub fn ocr_image(_app: AppHandle, _bytes: Vec<u8>, _engine: Option<String>) -> Result<OcrResult, String> {
    Err("OCR is available only on Windows".to_string())
}
