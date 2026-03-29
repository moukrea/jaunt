mod approval;
mod config;
mod files;
mod node;
mod pairing_server;
mod pid;
mod profile;
mod snag;

use clap::{Parser, Subcommand};
use tracing::error;

#[derive(Parser)]
#[command(name = "jaunt-host", about = "Jaunt host daemon", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Start the host daemon — accepts connections from paired devices
    Serve {
        /// Run as a background daemon
        #[arg(short, long)]
        daemon: bool,
    },
    /// Pair a new device — generates a PIN and waits for connection
    Pair,
    /// Manage paired devices
    Devices {
        #[command(subcommand)]
        action: DeviceAction,
    },
    /// Stop a running daemon
    Stop,
    /// Show daemon status
    Status,
}

#[derive(Subcommand)]
enum DeviceAction {
    /// List paired devices
    List,
    /// Revoke a device
    Revoke { peer_id: String },
}

fn init_logging(daemon: bool) {
    use tracing_subscriber::{fmt, EnvFilter};

    // Only show jaunt_host logs at INFO. Suppress cairn/libp2p noise (they flood
    // with interface discovery, listen addrs, mDNS, dial failures at INFO/WARN).
    // Users can override with RUST_LOG env var for debugging.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("error,jaunt_host=info"));

    if daemon {
        // Daemon mode: log to file
        let log_dir = dirs_log();
        std::fs::create_dir_all(&log_dir).ok();
        let file_appender = tracing_appender::rolling::daily(&log_dir, "jaunt-host.log");
        fmt()
            .with_env_filter(filter)
            .with_writer(file_appender)
            .with_ansi(false)
            .init();
    } else {
        // Foreground: log to stderr
        fmt()
            .with_env_filter(filter)
            .with_writer(std::io::stderr)
            .with_target(false)
            .init();
    }
}

fn dirs_log() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("XDG_DATA_HOME") {
        std::path::PathBuf::from(dir).join("jaunt")
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("jaunt")
    } else {
        std::path::PathBuf::from("/tmp/jaunt")
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = Cli::parse();

    // Commands that don't need logging or config
    match &cli.command {
        Some(Command::Stop) => {
            pid::cmd_stop();
            return;
        }
        Some(Command::Status) => {
            pid::cmd_status();
            return;
        }
        _ => {}
    }

    let config = config::JauntConfig::load();
    let is_daemon = matches!(&cli.command, Some(Command::Serve { daemon: true }));

    init_logging(is_daemon);

    let result = match cli.command {
        None | Some(Command::Serve { .. }) => {
            // Check for existing instance
            if let Err(msg) = pid::acquire() {
                error!("{msg}");
                eprintln!("error: {msg}");
                std::process::exit(1);
            }

            // Daemonize if requested
            if is_daemon {
                if let Err(e) = nix::unistd::daemon(true, false) {
                    error!("Failed to daemonize: {e}");
                    eprintln!("error: failed to daemonize: {e}");
                    pid::release();
                    std::process::exit(1);
                }
                // Re-write PID after fork (PID changed)
                pid::write_current();
            }

            let res = node::run_host(config).await;
            pid::release();
            res
        }
        Some(Command::Pair) => node::run_pair(config).await,
        Some(Command::Devices { action }) => match action {
            DeviceAction::List => {
                let store = approval::ApprovalStore::load();
                for device in store.list() {
                    println!(
                        "{:<20} {:<40} {}",
                        device.name, device.peer_id, device.approved_at
                    );
                }
                Ok(())
            }
            DeviceAction::Revoke { peer_id } => {
                let mut store = approval::ApprovalStore::load();
                store.revoke(&peer_id);
                store.save();
                println!("Revoked device: {peer_id}");
                Ok(())
            }
        },
        Some(Command::Stop) | Some(Command::Status) => unreachable!(),
    };

    if let Err(e) = result {
        error!("{e}");
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
