use serde::Deserialize;
use tauri::State;

use super::require_plugin_api;
use crate::plugins::PluginManager;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginAudioPlayOptions {
    #[serde(default = "default_audio_volume")]
    pub volume: f32,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default = "default_audio_speed")]
    pub speed: f32,
}

fn default_audio_volume() -> f32 {
    1.0
}
fn default_audio_speed() -> f32 {
    1.0
}

#[cfg(not(mobile))]
mod engine {
    use super::PluginAudioPlayOptions;
    use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
    use std::collections::HashMap;
    use std::fs::File;
    use std::io::BufReader;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;
    use std::thread;

    pub enum AudioCommand {
        Play {
            path: String,
            options: PluginAudioPlayOptions,
            respond: Sender<Result<String, String>>,
        },
        Stop {
            id: String,
            respond: Sender<Result<(), String>>,
        },
        Pause {
            id: String,
            respond: Sender<Result<(), String>>,
        },
        Resume {
            id: String,
            respond: Sender<Result<(), String>>,
        },
        SetVolume {
            id: String,
            volume: f32,
            respond: Sender<Result<(), String>>,
        },
        IsPlaying {
            id: String,
            respond: Sender<Result<bool, String>>,
        },
    }

    struct AudioPlayback {
        sink: Sink,
    }

    static SENDER: OnceLock<Option<Sender<AudioCommand>>> = OnceLock::new();

    pub fn sender() -> Result<&'static Sender<AudioCommand>, String> {
        let opt = SENDER.get_or_init(|| {
            let (tx, rx) = channel();
            match thread::Builder::new()
                .name("plugin-audio".into())
                .spawn(move || audio_loop(rx))
            {
                Ok(_) => Some(tx),
                Err(e) => {
                    crate::log_error!("plugin-audio", "failed to spawn audio thread: {e}");
                    None
                }
            }
        });
        opt.as_ref()
            .ok_or_else(|| "audio thread unavailable".to_string())
    }

    fn audio_loop(rx: std::sync::mpsc::Receiver<AudioCommand>) {
        let (_stream, stream_handle) = match OutputStream::try_default() {
            Ok(v) => v,
            Err(e) => {
                crate::log_error!("plugin-audio", "failed to create output stream: {e}");
                return;
            }
        };
        let mut playbacks: HashMap<String, AudioPlayback> = HashMap::new();
        let mut next_id: u64 = 1;

        while let Ok(cmd) = rx.recv() {
            match cmd {
                AudioCommand::Play {
                    path,
                    options,
                    respond,
                } => {
                    let res = play(&stream_handle, &mut playbacks, &mut next_id, &path, options);
                    let _ = respond.send(res);
                }
                AudioCommand::Stop { id, respond } => {
                    playbacks.remove(&id);
                    let _ = respond.send(Ok(()));
                }
                AudioCommand::Pause { id, respond } => {
                    let _ = respond.send(control(&playbacks, &id, |sink| sink.pause()));
                }
                AudioCommand::Resume { id, respond } => {
                    let _ = respond.send(control(&playbacks, &id, |sink| sink.play()));
                }
                AudioCommand::SetVolume {
                    id,
                    volume,
                    respond,
                } => {
                    let _ = respond.send(control(&playbacks, &id, |sink| {
                        sink.set_volume(volume.clamp(0.0, 2.0))
                    }));
                }
                AudioCommand::IsPlaying { id, respond } => {
                    let res = match playbacks.get(&id) {
                        Some(pb) => Ok(!pb.sink.empty()),
                        None => Err(format!("audio playback not found: {id}")),
                    };
                    let _ = respond.send(res);
                }
            }
            playbacks.retain(|_, pb| !pb.sink.empty());
        }
    }

    fn play(
        stream_handle: &OutputStreamHandle,
        playbacks: &mut HashMap<String, AudioPlayback>,
        next_id: &mut u64,
        path: &str,
        options: PluginAudioPlayOptions,
    ) -> Result<String, String> {
        let file = File::open(path).map_err(|e| format!("open audio file: {e}"))?;
        let reader = BufReader::new(file);
        let source = Decoder::new(reader).map_err(|e| format!("decode audio: {e}"))?;
        let sink = Sink::try_new(stream_handle).map_err(|e| format!("create audio sink: {e}"))?;

        sink.set_volume(options.volume.clamp(0.0, 2.0));
        sink.set_speed(options.speed.clamp(0.1, 4.0));

        if options.repeat {
            sink.append(source.repeat_infinite());
        } else {
            sink.append(source);
        }

        let id = format!("audio_{}", *next_id);
        *next_id += 1;
        playbacks.insert(id.clone(), AudioPlayback { sink });
        Ok(id)
    }

    fn control(
        playbacks: &HashMap<String, AudioPlayback>,
        id: &str,
        f: impl FnOnce(&Sink),
    ) -> Result<(), String> {
        let pb = playbacks
            .get(id)
            .ok_or_else(|| format!("audio playback not found: {id}"))?;
        f(&pb.sink);
        Ok(())
    }
}

#[cfg(not(mobile))]
fn audio_request<T>(
    f: impl FnOnce(std::sync::mpsc::Sender<Result<T, String>>) -> engine::AudioCommand,
) -> Result<T, String> {
    let sender = engine::sender()?;
    let (tx, rx) = std::sync::mpsc::channel();
    sender
        .send(f(tx))
        .map_err(|_| "audio thread disconnected".to_string())?;
    rx.recv()
        .map_err(|_| "audio thread response lost".to_string())?
}

#[tauri::command]
pub fn plugin_api_audio_play(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    path: String,
    options: Option<PluginAudioPlayOptions>,
) -> Result<String, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(not(mobile))]
    {
        let options = options.unwrap_or_default();
        audio_request(|respond| engine::AudioCommand::Play {
            path,
            options,
            respond,
        })
    }
    #[cfg(mobile)]
    {
        let _ = (path, options);
        Err("audio playback is not supported on mobile".into())
    }
}

#[tauri::command]
pub fn plugin_api_audio_stop(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    playback_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(not(mobile))]
    {
        audio_request(|respond| engine::AudioCommand::Stop {
            id: playback_id,
            respond,
        })
    }
    #[cfg(mobile)]
    {
        let _ = playback_id;
        Err("audio playback is not supported on mobile".into())
    }
}

#[tauri::command]
pub fn plugin_api_audio_pause(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    playback_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(not(mobile))]
    {
        audio_request(|respond| engine::AudioCommand::Pause {
            id: playback_id,
            respond,
        })
    }
    #[cfg(mobile)]
    {
        let _ = playback_id;
        Err("audio playback is not supported on mobile".into())
    }
}

#[tauri::command]
pub fn plugin_api_audio_resume(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    playback_id: String,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(not(mobile))]
    {
        audio_request(|respond| engine::AudioCommand::Resume {
            id: playback_id,
            respond,
        })
    }
    #[cfg(mobile)]
    {
        let _ = playback_id;
        Err("audio playback is not supported on mobile".into())
    }
}

#[tauri::command]
pub fn plugin_api_audio_set_volume(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    playback_id: String,
    volume: f32,
) -> Result<(), String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(not(mobile))]
    {
        audio_request(|respond| engine::AudioCommand::SetVolume {
            id: playback_id,
            volume,
            respond,
        })
    }
    #[cfg(mobile)]
    {
        let _ = (playback_id, volume);
        Err("audio playback is not supported on mobile".into())
    }
}

#[tauri::command]
pub fn plugin_api_audio_is_playing(
    window: tauri::WebviewWindow,
    plugins: State<'_, PluginManager>,
    plugin_id: String,
    playback_id: String,
) -> Result<bool, String> {
    require_plugin_api(&window, &plugins, &plugin_id)?;
    #[cfg(not(mobile))]
    {
        audio_request(|respond| engine::AudioCommand::IsPlaying {
            id: playback_id,
            respond,
        })
    }
    #[cfg(mobile)]
    {
        let _ = playback_id;
        Err("audio playback is not supported on mobile".into())
    }
}
