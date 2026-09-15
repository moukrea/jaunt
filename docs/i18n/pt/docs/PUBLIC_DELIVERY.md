[English](../../../PUBLIC_DELIVERY.md) · [fr](../../fr/docs/PUBLIC_DELIVERY.md) · [es](../../es/docs/PUBLIC_DELIVERY.md) · [it](../../it/docs/PUBLIC_DELIVERY.md) · [pt](PUBLIC_DELIVERY.md) · [de](../../de/docs/PUBLIC_DELIVERY.md)

# Entrega pública — 15 de setembro de 2026

Para as subsequentes correções beta.9 / desktop beta.7 / Android beta.5 e verificação pública, veja [resultados de regressão de entrega](DELIVERY_REGRESSIONS.md). As observações abaixo descrevem a versão anterior.

O aplicativo publicado é **https://moukrea.github.io/jaunt/**. Usuários finais não precisam de uma conta GitHub ou Cloudflare, VPN ou configuração de servidor de entrada.

- Máquina: [v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.8), Python versão `0.1.0b8`.
- Área de trabalho: [0.1.0-beta.6](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.6), Linux x64/ARM64 tar/deb/rpm e macOS x64/ARM64 zip/dmg pacotes.
- Android: [assinado beta.4 APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), [libertação e somas de verificação](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.4).
- Relé do projeto: `wss://jaunt-relay.moukrea.workers.dev`, com `APP_ORIGIN=https://moukrea.github.io`.

## Instalação validada

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

O comando exato extraído da página pública instalou o `0.1.0b8` em um novo recipiente Fedora 43. Um `jaunt gui --install-only` posterior baixou e verificou o arquivo de desktop e criou sua entrada do menu de aplicativos. O instalador normal executa esta configuração de desktop automaticamente quando detecta um host gráfico. O `jaunt gui` abre o aplicativo de desktop instalado; os pacotes de distribuição Linux também estão disponíveis na versão de desktop.

Um Ubuntu 24.04.5 VM separado actualizou a roda beta.5 pública não editável para o beta. 8 público, mantendo as identidades da máquina e do dispositivo e o seu serviço de utilizador activo activado. A actualização inicial seleccionou explicitamente a nova versão pública antes da mudança do canal de Páginas por omissão. A receita de aceitação pública subsequente usou o instalador por omissão publicado sem uma substituição da versão.

Atualizações automáticas do host retêm shells e transferências comuns. A autorização de reinicialização explícita é necessária para destruir shells ativo, incluindo tarefas de fundo que sobrevivem a um shell saído. O código final também remove o ambiente atual e legado sobrepõe-se de instalações automáticas. Android verifica as atualizações e usa o instalador do sistema Android; sua confirmação permanece necessária.

## Controlos observados

[PR # 18](https://github.com/moukrea/jaunt/pull/18) fundiu- se depois de passarem os seus controlos.](https://github.com/moukrea/jaunt/actions/runs/34950530292), [libertação da máquina](https://github.com/moukrea/jaunt/actions/runs/34950562658), [desktop release](https://github.com/moukrea/jaunt/actions/runs/34948505167)e [Android lançamento](https://github.com/moukrea/jaunt/actions/runs/34948504993) aprovado. Lançamentos precedidos [implantação de páginas](https://github.com/moukrea/jaunt/actions/runs/34951111652).

□ Comando ou ambiente real □ Resultado
|---|---|
O `pytest -q` passou; o Linux/macOS, o Python 3.11 e o 3.13
`npm test` 21 passado
| `npm run test:relay` Dois reais Miniflare/workerd tests: Web e origem nativa da área de trabalho, roteamento autenticado e hibernação ping; origens estrangeiras rejeitadas
□ `npm run prepare-web`; `python scripts/check_project.py` □ Activos e licenças locais fixados e gerados; verificação de recursos/importação/sintaxe aprovados
□ `python scripts/build_release.py` □ Roda, manifesto e SHA256SUMS construídos
`python tests/browser_e2e.py`, com relé de desenvolvimento e `jaunt_E2E_RELAY=workerd`, 23 cenários por backend, com PTYs real e transferências
□ `python tests/shared_workspace_e2e.py` em Xvfb □ Mesma PTY em Electron/browser; última visualização ativa o tamanho; fechar/reabrir e terminar; abas de divisão persistentes e achatamento móvel
| `python tests/terminal_render_e2e.py` □ Role para os limites da última linha/coluna final, seleção de texto, persistência do tema, saída sincronizada; isolado real Claude Code/Codex startup localmente
O `python tests/installer_e2e.py` 8 passou, incluindo adulteração de checksum, importação não editável, identidades retidas e recusa de reinício implícito
□ Fedora 43/44 CI; `installer_namespace_e2e.py`; `installer_storage_e2e.py` □ Instalação pública, cacho isolado, armazenamento temporário completo e recuperação de erro de escrita-curl passado
O Android Gradle unit/lint/debug/release builds e o `apksigner verify` (Passado); o APK público mantém o certificado de assinatura estabelecido
| `python tests/android_workspace_e2e.py` | Android 14 emulador: real relé público e shell, abertura/redimensionamento real do teclado, limites da barra de sistema, rotação e terminal- notificação BEL com tela desativada
□ Público APK beta.3 → beta.4, instalado com `adb install -r` □ Mesmo dispositivo autorizado reconecta sem emparelhamento; esta verificação não reivindica um fluxo de sistema-instalador in-app
O comando Linux `.deb` instalado em Ubuntu VM Real shell executado; renderizador Seccomp=2 e NoNewPrivs=1, sem sobreposição de uma caixa de areia
O `python tests/desktop_remote_e2e.py`; desktop público instalado em VM; desktop nativo autentica-se como um cliente remoto através do WSS público, executa um comando comprovado e termina a sessão
2 comandos comprovados em um PTY compartilhado; close/reopen retém-no; terminação remota remove ambas as visões
A máquina instalada pública, shell terminou com a tarefa de fundo teimosa □ Reiniciação não aprovada recusada; a área de trabalho Terminar mata o trabalho restante e remove a sessão
□ Activos públicos □ Três activos host, três activos Android e todos os dez pacotes de desktop verificados contra somas de verificação; caminhos de arquivo, assinatura APK e recursos de ícones originais verificados
□ Página Pública □ Corrigir três tags de lançamento; 25 recursos verificados em `/jaunt/` contra bytes construídos, incluindo JS local e licenças
O relé público do HTTP 200 da saúde, WebSocket real HTTP 101 e ping/pong; origem do navegador estrangeiro rejeitado com 403
□ `gitleaks dir` na fonte Git exportada, roda pública e aplicativo de desktop extraído
□ `npm audit`; `pip-audit --local --skip-editable` □ Nenhuma vulnerabilidade conhecida relatada nos ambientes de dependência verificados

O driver público de aceitação correu **12 verificações** contra a VM instalada no lançamento: emparelhamento, provada arbitrária-shell output, um burst de entrada de 512 caracteres, segunda aba e retorno, comparação upload/download byte, upload de imagem mais caminho citado sem Enter em um hospedeiro sem cabeça, recarregar sem QR, verdadeira interrupção IPv4/IPv6 com o mesmo shell PID depois, recusa de atualização implícita, reinício autorizado retendo identidades, revogação e nenhum erro de navegador não capturado. Veja [public-report.json](../../../evidence/public-report.json). Cada execução usou um novo diretório de fixação; nenhuma pasta pessoal foi digitalizada ou excluída.

A revisão final do relé é o `698962dd-b16a-49f8-b658-a3c5953b3da9` (Wrangler 4.131.2). Ele adiciona a origem exata do renderizador nativo `jaunt://app` ao lado da origem da web configurada. Ambas as origens públicas foram verificadas com atualizações reais do WebSocket/ping-pong, e o pareamento/comandos de clientes remotos foi verificado a partir do pacote de desktop instalado inalterado. A autenticação de roteamento e de ponta a ponta continua sendo necessária.

As versões da ferramenta e as descobertas do desenvolvimento estão em [WORKSPACE_VALIDATION.md](WORKSPACE_VALIDATION.md). Os arquivos de UI e pacotes entregues usam a arte original. O candidato do host beta.6 foi substituído antes de se tornar o canal padrão; o fluxo de trabalho de publicação beta.7 foi cancelado antes de uma versão ser criada. Tags e histórico foram mantidos.

## Limites de validação

O protocolo de segurança personalizado permanece **independentemente não auditado**. Testes automatizados e scanners de dependência não estabelecem uma certificação de segurança.

Nenhum aparelho Android físico estava disponível. Câmera QR captura, galeria / OEM variações, navegação de gestos físicos, Wi-Fi / handover móvel, push de tela ociosa profunda e bloqueada em um telefone real permanecem sem validação. Os resultados do emulador são relatados como resultados do emulador.

A execução e os prompts de confiança da área de trabalho macOS, o hardware ARM, a apresentação da notificação da área de trabalho nos ambientes e a entrega do provedor de push do navegador permanecem limites de validação específicos da plataforma. As compilações da área de trabalho macOS não são assinadas. Os arquivos Linux por usuário requerem uma caixa de areia Chromium funcionando; use o pacote de distribuição onde os espaços de nomes do usuário são restritos. Os lançadores de produção não desativam a caixa de areia.

As telas de inicialização Claude Code/Codex isoladas foram testadas sem pedidos de autenticação ou de modelo. As conversas completas de agentes e cada implementação específica de um agente não são reivindicadas como testadas. O upload de imagem mais a inserção de um caminho permanece distinto da área de transferência condicional nativa do sistema operacional mais o Ctrl+V; nem envia o Enter automaticamente. Uma máquina sem cabeça não adquire uma área de transferência do sistema operacional conectando um cliente.

Fechando uma visão preserva seu shell. Terminação explícita termina seus trabalhos de sessão POSIX; processos deliberadamente daemonizados que criam uma sessão separada do sistema operacional estão fora desse limite. O shells comum não pode sobreviver a uma reinicialização da máquina ou reinício do daemon; tmux permanece opcional para esse requisito de persistência separada.
