//! Cancellable downloads reuse the updater's proxy, signatures and installer.
//! Closing the cancellation resource drops the download future and connection.

use std::{future::Future, sync::Arc, task::Poll};
use tauri::{ipc::Channel, Manager, Resource, ResourceId, Webview};
use tauri_plugin_updater::Update;
use tokio::sync::watch;

struct DownloadCancellation(watch::Sender<bool>);

impl Resource for DownloadCancellation {
    fn close(self: Arc<Self>) {
        self.0.send_replace(true);
    }
}

struct DownloadedUpdate {
    update: Arc<Update>,
    bytes: Vec<u8>,
}

impl Resource for DownloadedUpdate {}

async fn cancellable<T>(
    download: impl Future<Output = Result<T, String>>,
    mut cancellation: watch::Receiver<bool>,
) -> Result<T, String> {
    if *cancellation.borrow() {
        return Err("更新已取消".into());
    }
    let mut download = Box::pin(download);
    let mut cancelled = Box::pin(cancellation.changed());
    std::future::poll_fn(|cx| {
        // Cancellation takes priority even if the final download chunk is ready.
        if cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(Err("更新已取消".into()));
        }
        download.as_mut().poll(cx)
    })
    .await
}

#[tauri::command]
pub fn create_update_download(webview: Webview) -> ResourceId {
    let (sender, _) = watch::channel(false);
    webview.resources_table().add(DownloadCancellation(sender))
}

#[tauri::command]
pub async fn download_update(
    webview: Webview,
    rid: ResourceId,
    cancel_rid: ResourceId,
    on_event: Channel<serde_json::Value>,
) -> Result<ResourceId, String> {
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    let cancellation = webview
        .resources_table()
        .get::<DownloadCancellation>(cancel_rid)
        .map_err(|e| e.to_string())?;
    let mut started = false;
    let bytes = cancellable(
        async {
            update
                .download(
                    |chunk_length, content_length| {
                        if !started {
                            started = true;
                            let _ = on_event.send(serde_json::json!({
                                "event": "Started", "data": { "contentLength": content_length }
                            }));
                        }
                        let _ = on_event.send(serde_json::json!({
                            "event": "Progress", "data": { "chunkLength": chunk_length }
                        }));
                    },
                    // JS emits Finished after download and signature verification succeed.
                    || {},
                )
                .await
                .map_err(|e| e.to_string())
        },
        cancellation.0.subscribe(),
    )
    .await?;
    Ok(webview
        .resources_table()
        .add(DownloadedUpdate { update, bytes }))
}

#[tauri::command]
pub async fn install_update(webview: Webview, bytes_rid: ResourceId) -> Result<(), String> {
    let package = webview
        .resources_table()
        .get::<DownloadedUpdate>(bytes_rid)
        .map_err(|e| e.to_string())?;
    package
        .update
        .install(&package.bytes)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_download_returns_bytes() {
        let (_sender, receiver) = watch::channel(false);
        let result =
            tauri::async_runtime::block_on(cancellable(async { Ok(vec![1, 2]) }, receiver));
        assert_eq!(result.unwrap(), vec![1, 2]);
    }

    #[test]
    fn cancellation_wins_over_ready_download() {
        let (sender, receiver) = watch::channel(false);
        sender.send_replace(true);
        let result = tauri::async_runtime::block_on(cancellable(async { Ok(()) }, receiver));
        assert_eq!(result.unwrap_err(), "更新已取消");
    }

    #[test]
    fn closing_resource_wakes_and_drops_pending_download() {
        use std::sync::atomic::{AtomicBool, Ordering};
        struct Download {
            dropped: Arc<AtomicBool>,
            started: Option<tokio::sync::oneshot::Sender<()>>,
        }
        impl Future for Download {
            type Output = Result<(), String>;
            fn poll(
                mut self: std::pin::Pin<&mut Self>,
                _: &mut std::task::Context<'_>,
            ) -> Poll<Self::Output> {
                if let Some(started) = self.started.take() {
                    let _ = started.send(());
                }
                Poll::Pending
            }
        }
        impl Drop for Download {
            fn drop(&mut self) {
                self.dropped.store(true, Ordering::SeqCst);
            }
        }
        tauri::async_runtime::block_on(async {
            let (sender, receiver) = watch::channel(false);
            let token = Arc::new(DownloadCancellation(sender));
            let dropped = Arc::new(AtomicBool::new(false));
            let (started, first_poll) = tokio::sync::oneshot::channel();
            let task = tauri::async_runtime::spawn(cancellable(
                Download {
                    dropped: dropped.clone(),
                    started: Some(started),
                },
                receiver,
            ));
            first_poll.await.unwrap();
            token.close();
            let result = tokio::time::timeout(std::time::Duration::from_secs(1), task)
                .await
                .unwrap();
            assert_eq!(result.unwrap().unwrap_err(), "更新已取消");
            assert!(dropped.load(Ordering::SeqCst));
        });
    }
}
