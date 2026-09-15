[English](../../../WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/WORKSPACE_VALIDATION.md) · [es](../../es/docs/WORKSPACE_VALIDATION.md) · [it](../../it/docs/WORKSPACE_VALIDATION.md) · [pt](WORKSPACE_VALIDATION.md) · [de](../../de/docs/WORKSPACE_VALIDATION.md)

# Validação do espaço de trabalho — 2026-09-15

Este relatório registra observações, não uma certificação. O protocolo personalizado permanece independentemente não auditado. A implantação pública e as verificações de liberação instaladas são registradas em [PUBLIC_DELIVERY.md](PUBLIC_DELIVERY.md); a tabela a seguir registra as verificações de desenvolvimento e plataforma.

## Observações locais

* Comando / ambiente * Resultado observado *
|---|---|
Já passou o `.venv/bin/python -m pytest -q` 61, incluindo um verdadeiro trabalho shell/background que ignora a terminação graciosa, trabalhos sobreviventes após a saída do shell, propriedade de geometria compartilhada, análise OSC dividida, criptografia/replay e atualizações seguras
O `npm test` 21 passou, incluindo retenção de árvores divididas, temas, criptografia, estimulação/ordem de entrada e desconexão-sem-input-replay
□ `npm run test:relay` □ Real workerd/Miniflare WebSocket upgrade, registro de objeto durável, roteamento e hibernação ping passou
□ `npm run prepare-web` □ Pacotes fixados xterm/fit e jsQR localmente, preserva suas licenças, instalador de cópias, regenera inventário de serviço-trabalhador □
□ `python scripts/check_project.py` □ Importações locais, caminhos de recursos e sintaxe passadas
□ `python scripts/build_release.py` Uma verdadeira roda host não editável, manifesto e SHA256SUMS construída com sucesso
`python tests/browser_e2e.py` 23 cenários passados: verdadeiros comandos PTY e 512 rotações de caracteres, clientes independentes, recuperação de rede, transferências de bytes exatos, comportamento de imagem/caminho/cabeça, bloqueio de cofre e revogação
| `DISPLAY=:179 python tests/shared_workspace_e2e.py` □ Actual Electron processo e navegador independente compartilhar um PTY; o redimensionamento passivo não rouba tamanho; retentores fechados/reabertos shell; terminar fecha todas as visualizações; separador sobreviver reload e achatar no móvel .
• `python tests/terminal_render_e2e.py` – Rolagem de roda de saída longa e retorno aos limites de última linha/coluna final, controle de seleção de texto nativo, temas persistentes, instalação de saída sincronizada; telas de inicialização Claude Code/Codex instaladas em perfis isolados e não autenticados
Testes de compilação/unidade de depuração do Gradle do Android
| `python tests/android_workspace_e2e.py` | Android 14 emulador: instalado APK → relé público de propriedade do projeto → host real isolado → comando comprovado; toque de tela real abre IME e encolhe viewport; limites da barra de status, rotação e notificação do sistema operacional de uma terminal BEL passou
□ Instalado `.deb` no Ubuntu 24.04.5 VM □ Aplicativo nativo aberto, roda candidato não editável executado um comando local comprovado PTY, renderizador tinha Seccomp=2 e NoNewPrivs=1, e nenhum cancelamento sandbox estava presente
O `npm audit` O Zero relatou vulnerabilidades na árvore de dependência resolvida

A cadeia de ferramentas local incluiu Python 3.14.2, Node 25.5.0, npm 11.8.0, Java 17, Gradle 9.5.0, Electron 44.3.0, xterm 6.0.0, FitAddon 0,11.0 e jsQR 1.4.0. CI usa Node 22 e sua matriz configurada Python/Linux/macOS. As verificações de inicialização CLI reais instaladas usaram Claude Code 2.1.272 e codex-cli 0,154.0; eles não submeteram solicitações de modelo ou inspecionam conversas/credenciais de usuário.

As referências da versão foram verificadas em relação a [Electronregisto oficial de lançamento](https://releases.electronjs.org/release/v44.3.0) e [Notas de lançamento do xterm](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). xterm 6 inclui suporte de saída sincronizado. npmA auditoria não substitui um Chromium/Electron revisão de segurança ou auditoria do protocolo personalizado.

## Resultados corrigidos durante a validação

- O FitAddon mediu um pai acolchoado, alocando linhas/colunas fora da área de exibição real. Uma montagem separada não acolchoada agora fornece a área medida; os testes verificam ambos os limites visíveis.
- O Android implementação acolchoado WebView em si em vez de seu layout externo. O quadro externo agora consome sistema/cortar / IME insets, eo UI compartilhado recebe o estado de teclado.
- O ícone Android original foi um desenho terminal independente. Android agora envia o PNG exato fornecido; o navegador/favicon/notificação/desktop referências usam a mesma arte.
- O pacote terminal fornecido não tinha a procedência exata de compilação. Agora é reconstruído a partir de dependências npm fixadas e ambas as licenças upstream.
- Fechando apenas uma visualização e matando o shell subjacente foram confundidos. Eles agora têm ações e testes de UI distintos.
- As permissões do pacote desktop herdaram uma umask de compilação privada, tornando o diretório instalado inacessível aos usuários comuns. O hook de embalagem agora normaliza diretórios de aplicativos e permissões executáveis/dados. A validação do sandbox embalado é rastreada separadamente dos testes de renderizador de modo fonte. As dependências ALSA/GBM/DRM explícitas também foram adicionadas após a instalação no Ubuntu limpo VM exposto uma biblioteca em falta.

O CI também capturou compatibilidade com o macOS Bash 3.2 no ambiente conhecido como bootstrap e uma falta de direção de estado de roda antiga/novo instalador. O bootstrap de compatibilidade agora é executado antes de importar uma roda antiga, incluindo invocações subsequentes do CLI. O verdadeiro teste de curva confinada do Fedora passa com o instalador público beta.5 roda e candidato.

A matriz host passou em Linux e macOS com Python 3.11 e 3.13. No macOS, o host usa a ligação waitid do sistema quando Python omite-o, seguindo o público da Apple [wait.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/wait.h) e [signal.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h) definições. Tanto em execução como em saída-shell terminação background-job são exercidos pelos mesmos testes de processo real em ambos os sistemas operacionais.

O teste Electron sem cabeça do modo fonte usa um accionamento sandbox somente de teste em um servidor X isolado. A verificação separada do pacote instalado passou sem esse accionamento no Ubuntu VM. O código principal/pré-carregamento da produção nunca desativa a sandbox.

## Os restantes limites de validação

Nenhum aparelho Android físico estava disponível. A captura real da câmera QR, as variações da galeria, o comportamento do OEM de navegação por gestos, a rotação física, a entrega do Wi-Fi/móvel e a entrega da notificação de resíduos profundos permanecem não validadas. As verificações do emulador IME/system-bar/screen-off não substituem esses testes.

A inicialização atual do CLI e uma instalação de saída sincronizada são testadas; uma conversa completa com o modelo autenticado, cada comportamento de versão do CLI redesenho, e cada implementação de inserção de imagem específica de um agente não são reivindicadas como validadas. O transporte de área de transferência nativa e a distinção explícita de upload/caminho sem cabeça permanecem separadas do reconhecimento de anexos de um agente.

A execução do desktop macOS, os prompts de confiança do SO, o hardware ARM, a apresentação da notificação do desktop em ambientes de desktop e a entrega do provedor de push do navegador requerem evidência específica da plataforma. Os resultados de compilação sozinho não são validação de tempo de execução. O backback do navegador permanece disponível, e nenhuma entrega incondicional ou comportamento perfeito em cada terminal/phone é prometido.
