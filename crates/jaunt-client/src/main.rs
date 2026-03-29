mod commands;
mod config;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "jaunt-client", about = "Jaunt CLI client", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Pair with a host
    Pair {
        #[command(subcommand)]
        method: PairMethod,
    },
    /// Connect to a paired host
    Connect {
        /// Host alias
        host: String,
        #[command(subcommand)]
        action: ConnectAction,
    },
    /// Manage paired hosts
    Hosts {
        #[command(subcommand)]
        action: HostAction,
    },
}

#[derive(Subcommand)]
enum PairMethod {
    /// Pair via PIN code
    Pin {
        /// PIN code displayed by host
        pin: String,
        /// Alias for this host
        #[arg(long)]
        alias: Option<String>,
    },
    /// Pair via link (URL with embedded connection profile)
    Link {
        /// Link URL from host
        link: String,
        /// Alias for this host
        #[arg(long)]
        alias: Option<String>,
    },
}

#[derive(Subcommand)]
enum ConnectAction {
    /// List sessions on the host
    Sessions,
    /// Attach to a session
    Attach {
        /// Session ID or name
        session: String,
    },
    /// Send a command to a session
    Send {
        /// Session ID or name
        session: String,
        /// Command to send
        command: String,
    },
    /// Browse files on the host
    Files {
        /// Path to browse
        #[arg(default_value = "~")]
        path: String,
    },
    /// Create a new session on the host
    New {
        /// Session name
        #[arg(long)]
        name: Option<String>,
    },
    /// Kill a session on the host
    Kill {
        /// Session ID or name
        session: String,
    },
}

#[derive(Subcommand)]
enum HostAction {
    /// List paired hosts
    List,
    /// Remove a paired host
    Remove {
        /// Host alias
        alias: String,
    },
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let cli = Cli::parse();
    let mut client_config = config::ClientConfig::load();

    let result = match cli.command {
        Command::Pair { method } => match method {
            PairMethod::Pin { pin, alias } => {
                commands::cmd_pair_pin(&client_config, &pin, alias.as_deref()).await
            }
            PairMethod::Link { link, alias } => {
                commands::cmd_pair_link(&mut client_config, &link, alias.as_deref()).await
            }
        },
        Command::Connect { host, action } => {
            let host_info = client_config.get_host(&host);
            if host_info.is_none() {
                eprintln!(
                    "error: unknown host '{host}'. Run 'jaunt-client hosts list' to see paired hosts."
                );
                std::process::exit(1);
            }
            let host_info = host_info.unwrap().clone();

            match action {
                ConnectAction::Sessions => commands::cmd_sessions(&client_config, &host_info).await,
                ConnectAction::Attach { session } => {
                    commands::cmd_attach(&client_config, &host_info, &session).await
                }
                ConnectAction::Send { session, command } => {
                    commands::cmd_send(&client_config, &host_info, &session, &command).await
                }
                ConnectAction::Files { path } => {
                    commands::cmd_files(&client_config, &host_info, &path).await
                }
                ConnectAction::New { name } => {
                    commands::cmd_new_session(&client_config, &host_info, name.as_deref())
                        .await
                        .map(|_| ())
                }
                ConnectAction::Kill { session } => {
                    commands::cmd_kill_session(&client_config, &host_info, &session).await
                }
            }
        }
        Command::Hosts { action } => match action {
            HostAction::List => {
                commands::cmd_hosts_list(&client_config);
                Ok(())
            }
            HostAction::Remove { alias } => {
                client_config.remove_host(&alias);
                client_config.save();
                println!("Removed host: {alias}");
                Ok(())
            }
        },
    };

    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
