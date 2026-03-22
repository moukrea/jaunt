.PHONY: validate build fmt

validate:
	cargo fmt --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace

build:
	cargo build --release

fmt:
	cargo fmt
