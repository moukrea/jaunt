mod approval;
mod config;
mod files;
mod node;
mod profile;
mod snag;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "jaunt-host", about = "Jaunt host daemon", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Start the host daemon (default)
    Serve,
    /// Generate a pairing profile and wait for a peer to connect
    Pair,
    /// Manage paired devices
    Devices {
        #[command(subcommand)]
        action: DeviceAction,
    },
}

#[derive(Subcommand)]
enum DeviceAction {
    /// List paired devices
    List,
    /// Revoke a device
    Revoke { peer_id: String },
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = Cli::parse();
    let config = config::JauntConfig::load();

    let result = match cli.command {
        None | Some(Command::Serve) => node::run_host(config).await,
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
    };

    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
