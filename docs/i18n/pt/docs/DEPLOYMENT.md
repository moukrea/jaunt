[English](../../../DEPLOYMENT.md) · [fr](../../fr/docs/DEPLOYMENT.md) · [es](../../es/docs/DEPLOYMENT.md) · [it](../../it/docs/DEPLOYMENT.md) · [pt](DEPLOYMENT.md) · [de](../../de/docs/DEPLOYMENT.md)

# Implementação do mantenedor

Os usuários finais só instalam a máquina. O ** proprietário do projeto** implementa estes dois componentes uma vez:

1. Páginas GitHub: HTML, JavaScript, CSS, logotipo, instalador e configuração pública.
2. Cloudflare Worker por um objeto durável SQLite: relé WebSocket. Não o substitua por um trabalho GitHub Actions, um túnel pessoal ou servidores públicos de outro projeto.

## Preparação

Preservar o repositório existente em um ramo de backup, então integrar os arquivos em um ramo de trabalho. Não sobrescrever o histórico ou force-push. Instale Python e Node 22+, então execute `pip install -e . -r requirements-dev.txt`, `npm ci` e `npm run prepare-web`. A compilação copia jsQR 1.4.0 e sua licença localmente e gera uma cache PWA versionada. Persista nas licenças `package-lock.json` genuinamente resolvidas e reveja; nunca invente um lockfile.

As ferramentas de implantação são fixadas e o lockfile resolvido está comprometido. O sharp/undici substitui os conselhos de endereços conhecidos na dependência do teste Miniflare 4; veja [VALIDATION.md](VALIDATION.md).

## Retransmissão

- Crie ou selecione uma conta Cloudflare autorizada para Trabalhadores e Objetos Duráveis SQLite. Verifique os termos e quotas atuais da conta.
- Autorize o agente a implantar, ou defina os segredos de Ações `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` através da interface segura do GitHub. O token deve permitir a implantação do Trabalhador e migração de Objetos Duráveis nessa conta.
- `relay.yml` roda Wrangler com `relay/wrangler.jsonc`: nome inicial `jaunt-relay`, ligação `ROOMS`, classe `Room`, migração SQLite `v1`.
- APP_ ORIGIN deve ser `https://moukrea.github.io` (a origem, sem `/jaunt/`). Não use `*` na produção. `config.json` deve conter o URL atual do Trabalhador WSS, sem um caminho `/v1/room/...` anexado; o cliente constrói esse caminho.
- Verifique `/health`, em seguida **real emparelhamento e um comando criptografado**. Uma resposta de saúde HTTP 200 não valida WebSockets.

## Host, desktop e lançamentos Android, em seguida, Páginas

1. Pass CI. Crie a etiqueta da máquina, atualmente `v0.1.0-beta.10` (Python versão `0.1.0b10`). O fluxo de trabalho de lançamento constrói a roda e publica-a com `host-manifest.json` e `SHA256SUMS`. As versões Beta são explicitamente marcadas como pré-lançamentos. Nunca sobrescreva os ativos de uma versão existente.
2. Para Android, publique a tag, atualmente `android-v0.1.0-beta.7`, com seu APK assinado, `SIGNING-CERTIFICATE.txt` e `SHA256SUMS`; verifique os ativos públicos. Mantenha a mesma chave de assinatura para atualizações.
3. Publique os arquivos `desktop-v0.1.0-beta.9`: Linux x64/ARM64, pacotes deb/rpm, pacotes macOS x64/ARM64 zip/dmg e `SHA256SUMS`. Verifique os arquivos públicos antes de publicá- los. O pacote Linux deve manter o suporte à caixa de areia Chromium; as construções macOS não são assinadas.
4. Define as variáveis do repositório `jaunt_RELAY_URL` (atual WSS URL), `jaunt_RELEASE_TAG` (`v0.1.0-beta.10`), `jaunt_ANDROID_RELEASE_TAG` (`android-v0.1.0-beta.7`), `jaunt_DESKTOP_RELEASE_TAG` (`desktop-v0.1.0-beta.9`), e opcionalmente `jaunt_PAGE_URL` (padrão para o URL da página do repositório). Nunca coloque fichas de host ou emparelhamento de segredos em variáveis públicas.
5. Activar Páginas no modo GitHub Actions. O `pages.yml` constrói o aplicativo web, valida a configuração, copia o instalador e publica-o.
6. Não executar Páginas com uma versão inexistente. O prompt de implementação requer esta ordem.

## Ensaios de aceitação remota necessários

Em uma máquina Linux sem uma porta de entrada exposta: instalar a partir da página publicada, digitalizar o código QR no Chrome Android, criar um shell, executar um comando, carregar e baixar um arquivo, colar uma imagem, testar ambos os modos de imagem de acordo com as capacidades do host, fechar/reabrir o PWA, alternar Wi-Fi/redes móveis, retornar ao mesmo shell sem um código QR, testar empurrar com a tela bloqueada, e revogar o dispositivo. Repita o caminho mínimo em macOS e Firefox/Safari quando disponível.

Nunca marque um teste não executado como validado. O relatório local incluído não prova por si só a produção de conectividade Cloudflare ou o comportamento físico-phone.

## Publicação e operações

Mantenha registros técnicos sem carga útil, monitore erros e cotas, planeie rotações de identidade e backups privados do estado- host e não transforme o relé em armazenamento de arquivos. As atualizações do trabalhador podem quebrar conexões; hosts e clientes devem se reconectar sem emparelhar novamente. Removendo o código não retorna migrações de objetos duráveis.

Fontes primárias: [Projecto durável WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Comandos de Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Páginas fluxos de trabalho](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [instalação uv](https://docs.astral.sh/uv/getting-started/installation/).

## Implementação anterior, 14-15 de setembro de 2026

Veja [o relatório de entrega atual](SESSION_CONTROLS_VALIDATION.md) para versões subsequentes e resultados de aceitação observados.

Páginas: https://moukrea.github.io/jaunt/; relé: `wss://jaunt-relay.moukrea.workers.dev`; lançamento do host: `v0.1.0-beta.9`; APK: `android-v0.1.0-beta.5`.

O Worker foi implantado usando Wrangler OAuth autorizado pelo proprietário, armazenado localmente com criptografia e uma chave no chaveiro do sistema. `CLOUDFLARE_ACCOUNT_ID` é definido em GitHub; uma futura implantação de retransmissão através das Acções necessitará da sua própria `CLOUDFLARE_API_TOKEN`. Nenhum token temporário do OAuth foi copiado para um segredo permanente da API. Os usuários finais não precisam tomar nenhum Cloudflare ou GitHub Ver [Validation.md](VALIDATION.md) para os resultados observados e suas limitações.
