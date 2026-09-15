[English](../../../VALIDATION.md) · [fr](../../fr/docs/VALIDATION.md) · [es](../../es/docs/VALIDATION.md) · [it](../../it/docs/VALIDATION.md) · [pt](VALIDATION.md) · [de](../../de/docs/VALIDATION.md)

# jaunt — entrega validada em 14 de setembro de 2026

Entrega atual: [controlos de sessão, feedback do cliente, testes de lançamento público e limitações](SESSION_CONTROLS_VALIDATION.md). Host anterior beta.5 / Android beta.3 entrega: [relatório consolidado histórico](PUBLIC_DELIVERY.md). As seções abaixo retêm observações históricas; relatórios posteriores sobrepõem suas contagens de teste e status específico de versão.

** Página: https://moukrea.github.io/jaunt/**

**Relay: wss://jaunt-relay.moukrea.workers.dev

**Libertação: [v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)**

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

A forma anterior deste comando (`curl -fsSL … | bash`) foi executada em um Ubuntu VM limpo sem fonte editável. Veja [rootstrap corrections and Fedora testing](INSTALLER_FEDORA.md) for the current command. Os usuários finais não criam nenhuma conta GitHub/Cloudflare e não configuram nem um servidor público nem um VPN. **O protocolo e o produto permanecem sem uma auditoria de segurança independente.** As limitações do SECURITY.md, incluindo a origem compartilhada das Páginas, ainda se aplicam.

## História e publicação

O arquivo foi integrado sem ler a implementação antiga para inspiração. O commit original `eb71cfe9b80749d3c53f11e428f027b0d64fb372` é preservado no `backup/pre-rewrite-20260914`. PRs [8](https://github.com/moukrea/jaunt/pull/8) e [9](https://github.com/moukrea/jaunt/pull/9) foram mesclados após verificações necessárias, sem contornar proteções, força-empurrar ou apagar o histórico. Beta.1 permanece imutável; as correções do host foram publicadas em beta.2.

O proprietário concedeu Wrangler OAuth através do navegador. jaunt Worker versão `00dd364c-c69c-4e89-8878-00ebd38ca414` usa `ROOMS` / `Room`, migração SQLite `v1` e APP_ORIGIN `https://moukrea.github.io`. Nenhum outro relé do projeto foi usado. HTTP saúde, autenticação WebSocket, roteamento bidirecional, ping/pong, e rejeição de uma origem não autorizada foram verificados. Real emparelhamento criptografado e operação shell foram então testados publicamente.

[Beta.2 release](https://github.com/moukrea/jaunt/actions/runs/34855623613): três ativos públicos (roda, host-manifest.json, SHA256SUMS) baixados e verificados antes de [Pages](https://github.com/moukrea/jaunt/actions/runs/34855764137). GitHub variáveis jaunt_RELAY_URL, jaunt_RELEASE_TAG e jaunt_PAGE_URL foram definidos. As 25 solicitações de recursos da página, incluindo módulos JS, imagens, licenças jsQR/xterm, instalador e trabalhador de serviço, foram comparadas com bytes entregues sob `/jaunt/`. Nenhum runtime JS veio de um CDN.

As credenciais OAuth são armazenadas criptografadas com uma chave no chaveiro do sistema local. O CLOUDFLARE_ ACCOUNT_ ID está definido no GitHub; uma futura implementação de retransmissão de ações ainda requer o seu próprio CLOUDFLARE_ API_ TOKEN. A implantação observada usou o OAuth local, não um token GitHub ou um token OAuth copiado como um segredo de API permanente. Isto não envolve os usuários finais.

## Comandos e resultados observados

Configuração do desenvolvimento: `python3 -m venv .venv`, em seguida, `pip install -e . -r requirements-dev.txt pip-audit` e `npm ci`. Instalação do desenvolvimento editável é separada do teste da roda.

Resultado do comando
|---|---|
□ `npm install`, em seguida, `npm ci` □ Real package-lock.json resolvido e comprometido; instalação reprodutível
`npm run prepare-web` 20 recursos; jsQR 1.4.0 e licença Apache copiados localmente
O `pytest -q` passou **36; o verdadeiro PTY, interoperabilidade Web Crypto, actualização atómica, envio interrompido
* `npm test` * 17 passado *
| `npm run test:relay` * 1 trabalhador real /Miniflare integração passada**, SQLite e WebSockets |
□ `python scripts/check_project.py` — Passado sem a isenção `--source`
□ `python scripts/build_release.py` □ Beta.2 roda, manifesto, e checksums construídos
□ `python -m playwright install chromium` □ Chromium realmente instalado
□ `python tests/browser_e2e.py` **20 cenários passados** em CI com o relé Python
* `jaunt_E2E_RELAY=workerd python tests/browser_e2e.py` * **20 cenários passados**, localmente e em IC *
. . `python tests/installer_e2e.py` . . . . . . . 8 controlos passados** em beta. 2, localmente e em CI . . .
□ `jaunt_INSTALLER_ONLINE=1 python tests/installer_e2e.py` □ **8 verificações passadas** em beta.1, usando um espelho loopback e dependências PyPI em ambientes frescos
* `npm audit` * **0 vulnerabilidades conhecidas** no gráfico resolvido *
| `pip-audit` Vulnerabilidades conhecidas**; o local jaunt pacote está ausente de PyPI e, portanto, não coberto .

[BETA.2 CI](https://github.com/moukrea/jaunt/actions/runs/34855112550): sete trabalhos de sucesso, incluindo 36 testes de host em Linux/macOS × Python 3.11/3.13 e ambos os conjuntos de 20 cenários de navegador. Requisitos de proteção de ramificação `lint` e `test` executam verificações reais; esta última depende de todas as suítes completas terem sucesso.

Versões locais: Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1, dramaturgo 1.62.0, Chromium 151.0.7922.34. IC: Node 22, Python 3.11/3.13. Host: websockets 16.0, criptografia 50.0.1, qrcode 8.2, pywebpush 2.5.0. Build: setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2, direct Miniflare 4.20260730.0; Wrangler também utiliza Miniflare 5.20260911,1-alfa. Miniflare sobreposições: ponto 0,35.4 e undici 7.29.0.

Criptografia inicial/pip e Miniflare/sharp/undici foram abordados com atualizações e substituições fixadas, em seguida, retestadas. Fontes: [criptografia](https://github.com/pyca/cryptography/security/advisories), [afiado](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [undici](https://github.com/advisories/GHSA-4cwx-7wf7-3272). A proveniência/versão exata do pacote xterm fornecido permanece limitada conforme descrito em Third_PARTY_NOTICES.md; npm A auditoria não cobre este pacote.

## Teste público de aceitação numa máquina limpa

QEMU/KVM Ubuntu 24.04 VM, Python 3.12.3, imagem oficial verificada contra SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`. Não foi instalado nenhum código fonte ou tempo de execução editável. A instalação pública beta.1 produziu um código QR e habilitou o serviço de usuário systemd; uma inicialização automática real confirmada, conectividade de retransmissão e identidade retida.

Um script de aceitação privado conduziu SSH e Chromium contra a página pública. Ele executou o comando de instalação atual, `jaunt status`, `jaunt pair --json`, comandos `systemctl --user` e interações UI. Os códigos QR e saída privada permanecem fora do repositório. Resultados:

- Emparelhamento público e um canal autenticado criptografado através do Cloudflare.
- shell, `printf`/`cat` e `PUBLIC_jaunt_PROVED` verificados tanto no terminal quanto em um arquivo; segunda aba e retorno ao primeiro.
- Multi-chunk Unicode/binário uploads e downloads comparados byte para byte.
- Imagem transferida e citou o caminho inserido sem Enter; um arquivo sentinela verificou que nada foi executado automaticamente. A pasta nativa foi desabilitada nesta VM sem cabeça.
- Página recarregar com identidade lembrada e nenhum novo código QR.
- Interrupção real da rede VM através de uma regra temporária limitada a essa VM e removida em um bloco `finally`: mesmo shell PID e sessão, com um comando `RESUMED` comprovado após reconectar sem emparelhar.
- A actualização pública recusou- se com dois shells normais activos; o daemon retido.
- Atualização com `jaunt_ALLOW_RESTART=1`: reinicialização explícita, shells encerrado, serviço ativo, host/device identidades preservadas, navegador reconectado.
- A revogação desconectou o navegador e desativou a criação do shell.
- Nenhuma exceção de navegador não captada.

As onze verificações foram registradas no `docs/evidence/public-report.json`, ao lado das evidências do instalador worked e beta.2 . Nesse ponto, o `browser-report.json` manteve a execução local anterior de 18 cenários como evidência histórica; o IC referenciado provou a suíte de 20 cenários. Os arquivos de evidência foram atualizados para a entrega posterior descrita em PUBLIC_DELIVERY.md.

## Falhas corrigidas sem remover funcionalidades ou asserções

- Uma resposta tardia da lista de pastas sobrescreveu o caminho digitado: os rascunhos por máquina e as revisões de requisição o fixaram; o teste atrasa as respostas criptografadas reais.
- Asserções ler o terminal antes da entrega assíncrona: espera limitada agora verificar saída real, inserção, ou anexo concluído.
- Uma verificação Bash separada do desligamento correu com a criação do shell: o desligamento atômico do daemon fecha a admissão.
- Perda da máquina mascarada com retransmissão: as mensagens autenticadas da máquina são monitoradas separadamente e ativam a reconexão. O teste suspende a máquina real enquanto deixa o relé em execução.
- Uma exceção WebSocket durante o envio terminou a tarefa de saída PTY: os envios interrompidos tornam-se ConnectionError e fecham o canal. Duas regressões real-PTY falham com o transporte antigo e passam após a correção, incluindo replay e saída fresca no mesmo PID.
- Testes sem cabeça herdaram o ambiente de trabalho e perfis pessoais: variáveis gráficas são removidas e teste shells executado sem perfis em diretórios temporários.
- Matar apenas o pai Miniflare deixou workerd conectado: o arnês agora interrompe seu próprio grupo de processo isolado.

## Limitações e relatórios que devem permanecer visíveis

Estas observações descrevem a entrega inicial do beta.2; validação posterior abaixo e em PUBLIC_DELIVERY.md registra o progresso subsequente.

- O agente não usou nenhum telefone físico. O usuário relatou o emparelhamento móvel bem- sucedido após esquecer um item lembrado; que não valida a câmera, teclado/IME, galeria, rotação, Wi-Fi/mobile handoff, PWA suspenso ou push na tela bloqueada. O usuário também relatou o erro na pasta de captura de tela Android no Claude Code; esse fluxo específico ainda estava sob investigação neste ponto.
- A entrega real do Web Push e a pasta nativa dentro de Claude/Codex não foram validadas. Um caminho inserido não é um anexo nativo; nenhuma área de transferência OS é prometida em uma máquina sem cabeça.
- lançado, instalação macOS/WSL, bootstrap sem Python, Safari/Firefox, tmux real, carga sustentada, cotas/custos de relé e SLA não foram validados nesta execução inicial.
- O protocolo, host, frontend e relé não têm auditoria independente.

## Artefactos e privacidade

Os três ativos de cada versão foram baixados, verificados e inspecionados o conteúdo da roda. O Gitleaks 8.30.1 não encontrou vazamentos nas rodas. O snapshot inicial produziu um falso positivo revisado: o conteúdo JavaScript FourKeyMap/TwoKeyMap do xterm. Verificações cobrem o projeto e suas configurações, nunca varreduras destrutivas de diretórios pessoais. Nenhum host.json, estado de desenvolvimento, código QR, cofre, segredo ou conteúdo privado do terminal é publicado. Os fluxos de trabalho foram revisados e usam o npm ci; Páginas verificam todos os três ativos antes da implantação. O ZIP é construído a partir de uma lista de allowlist, com verificações CRC, comparações de byte e checksums por arquivo. A licença jsQR está preservada intacta, incluindo sua nova linha final.

## Correções de usabilidade após feedback do usuário

A pasta pode tratar o texto vazio como uma pasta de sucesso. Agora abre uma área de pasta rica quando a API não fornece nenhum conteúdo útil, aceita o FileList/DataTransfer images e os dados de PNG incorporados do HTML, e nem insere HTML nem baixa URLs externas. Uma única imagem é enviada automaticamente para a área de transferência da máquina e depois o Ctrl+V na sessão capturada, quando uma infraestrutura nativa estiver disponível. As máquinas sem cabeça mantêm a opção de localização explícita. Os erros da máquina não estão mais disfarçados como falhas de permissão para a área de transferência móvel.

O fluxo local workerd atingiu **22 cenários**, incluindo ler uma imagem real através da API da Área de Transferência do Chromium e simular um resultado de texto vazio seguido de pasta rica para uma máquina real. Este último simula apenas a entrada da área de transferência; ele não reivindica a interação Android.

Um Xvfb/X11 VM separado também recebeu a imagem do navegador através do Trabalhador público e instalou a roda beta. 2. O Xclip PNG corresponde exatamente ao ficheiro carregado, e o PTY recebeu apenas o byte `16` (Ctrl+V), sem o Enter. Este teste de pré-publicação injectou os ficheiros de interface de ramificação no Chromium na origem da página; veja o `native-clipboard-report.json`. Ele não prova a visualização do anexo dentro do Claude Code/Codex. O utilizador informou que ambos os modos de anexação funcionavam no seu dispositivo; a correção específica do Paste ainda aguardava confirmação no seu telemóvel.

Transferências não são mais uma guia permanente. Rastreamento, cancelamento e caminhos permanecem disponíveis em Arquivos → Atividade de transferência após uma transferência; o navegador salva downloads.

O macOS CI revelou outro caso de encerramento: a bandeira viva do ceifeiro poderia permanecer verdadeira após o processo ter realmente terminado. O fechamento agora verifica o Popen.poll antes de sinalizar o grupo de processo. O EPERM é tolerado somente se o processo tiver terminado; a falha em uma criança viva permanece um erro. Uma regressão verifica que um PID já saiu nunca foi sinalizado. Isto trouxe a suíte local para 37 testes e preparou o beta.3.

## Cliente Android e acompanhamento beta.3 — 2026-09-14

O PR #10 passou por cada tarefa de CI, incluindo 37 testes Python em Linux/macOS e ambas as infra- estruturas de retransmissão do navegador, depois fundiram-se como `f85b9cb`. O servidor público `v0.1.0-beta.3` foi publicado pela execução `34859426583`; todos os três ativos públicos, conteúdo de roda e somas de verificação foram verificados, e a varredura secreta da roda não encontrou vazamentos. Páginas executaram o `34859891960` bem sucedido; sua configuração beta.3 e recursos de interface alterados foram comparados com a fonte de fusão. O Ubuntu isolado VM atualizado do instalador público com sua identidade preservada e seu serviço de usuário ativo.

Observação de compilação local do Android:

- JDK 17; Gradle 9.5.0 com distribuição oficial SHA-256; AGP 9.3.2; compilar SDK 37.0 / target 36 / mínimo 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon`: bem- sucedido. Passaram dois testes de unidade de protocolo nativo (criptografia bidirecional, replay/tamper rejection e ligação à prova). O canal nativo também autenticou- se contra a máquina pública Python, independentemente destas unidades.
- Fito Android: não há erros. Os avisos restantes dizem respeito à API alvo deliberadamente retida 36, a versão Gradle compatível, JavaScript sendo habilitado para a interface empacotada e análise de guarda de recursos; estes são limites revisados, não asserções suprimidas. Um retorno de chamada de recuperação de perda renderizador foi posteriormente adicionado após o aviso de fiação WebKit.
- OSV queriou todos os 21 artefatos Android soluted release runtime Maven: no reported adverties on 2026-09-14. Esta é uma cobertura de banco de dados, não uma auditoria de segurança. WebKit foi atualizado para 1.17.0 e a biblioteca de testes JVM JSON para 20260814 após verificar as versões disponíveis.
- `apksigner verify --verbose --print-certs`: versão assinada O APK verifica com o APK Signature Scheme v2, RSA 4096, certificado SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. A instalação e o lançamento do APK assinados locais tiveram sucesso no emulador. A depuração de liberação está desabilitada; a automação de ponta a ponta abaixo usou a depuração WebView da compilação de depuração, não um endpoint de depuração de produção.
- Android 14/API 34 x86_64 emulador: instalado APK → público Cloudflare relé → release público-instalado beta.3 host → real shell arquivo de comando e saída; nativo Android Viagem de ida e volta da área de transferência de texto; canal de notificação encriptado Java nativo; real Android notificação com o ecrã de fundo e emulador do aplicativo desligado; nativo Android área de transferência de imagem → upload → máquina isolada área de transferência X11 → PTY byte `16` (Ctrl+V), não Enter, bytes PNG iguais; rotação e alternância de rede mantêm o mesmo shell ID/PID; Android A janela de gravação escreve os 'bytes' binários exactos.
- A área de transferência Android é uma instrumentação separada APK. Não está na aplicação assinada. Todos os testes de máquina/clipboard/image usaram dados sintéticos na VM/emulador isolado, nunca na área de transferência do utilizador ou nas pastas pessoais.
- Após a integração de interface compartilhada: `npm test` e `npm run test:relay` passou; `python tests/browser_e2e.py` passou todos os 22 cenários do navegador; `python scripts/check_project.py` passou. GitHub CI repete ambas as infra-estruturas de relé do navegador antes de mesclar.

Evidência: `docs/evidence/android-report.json` e `android-dependency-audit.json`. Digitalização física da câmera Android, comportamento real do teclado/IME, variantes da galeria, transferência real do Wi-Fi/móvel, comportamento profundo da bateria ociosa/OEM e reconhecimento do anexo dentro de uma versão real do Claude Code/Codex não são reivindicadas. Entrega de notificação do emulador de tela-off não é prova de push de fundo garantido. O protocolo e implementação nativa permanecem independentemente não auditados.

Uma observação de início em branco específica para lançamento bloqueou a publicação durante a validação. O recipiente nativo agora mantém uma tela de abertura/retentação explícita até que o aplicativo empacotado confirme a prontidão e requeira um desenho. Três inícios a frio consecutivos da versão assinada não depurada então exibiram o espaço de trabalho. O CI inicial de execução limpa também rejeitou dois checksums de metadados de Gradle ausentes; uma nova resolução de dependência de cache gerou os valores de verificação de POM/módulo ausentes sem desativar a verificação.

## Actualizações automáticas — validação da implementação

O atualizador de host solicitado adiciona seis testes de falha/segurança: uma atualização baixada diferi com um status real de sessão ativa, mesmo quando a autorização de reinicialização é herdada; os bytes de roda adulterados não podem atingir o desligamento da máquina; as tiras automáticas de instalação reiniciam e os sobreposições do desenvolvedor; o reinício explícito é tratado separadamente; as etiquetas de liberação antigas/inválidas são rejeitadas; a desativação das atualizações automáticas impede o acesso à rede. O `pytest -q`: **43 passou**. O pacote de instalação real ainda passa todas as verificações **8, incluindo a recusa ativa do PTY e o reinício explícito. A instalação pública automática de versão a versão a versão e o instalador real da atualização do Android são rastreados separadamente destes testes e devem ser gravados após a publicação da versão.

O APK assinado (não-debuggable) emparelhou com sucesso através do Android's Documents/gallery picker usando uma imagem QR, contra o relé público beta.3 e Cloudflare. A janela de permissão de câmera real do Android e o lançamento do scanner ZXing nativo também foram exercitados; uma câmera física real decodificando um QR ainda não é reivindicada. O APK ignora deliberadamente o antigo código de barras do WebView para a decodificação da galeria QR: essa API caiu no emulador quando o Google Play Services estava ausente; o pacote jsQR decodificado o mesmo pareamento com sucesso.

A guarda de desligamento de atualização automática agora também adia durante as transferências de arquivos. Um envio temporário real permanece errível após uma reinicialização recusada e completa com bytes idênticos antes do desligamento ser permitido. Python suite agora reporta **45 passou**. Android a descoberta de lançamento usa o canal público de página verificado em vez de exigir que cada dispositivo consuma GitHub Quota de API. Testes de JVM nativos: **3 passados**. O assinado APK também executou um comando através de sua Android Compose/keyboard input; o arquivo da máquina resultante continha os bytes exatos esperados.

## Lançamento de espaço de trabalho compartilhado

Veja [validação de espaço de trabalho](WORKSPACE_VALIDATION.md) para o ambiente de trabalho atual/sessão compartilhada, geometria terminal, insets Android e alterações de notificação. Observações beta anteriores acima permanecem históricas e não implicam que cada nova combinação de plataforma foi testada.

## Regressões de entrega subsequentes

Veja [regressão de entrega fixa](DELIVERY_REGRESSIONS.md) para o ambiente shell relatado pelo usuário, Ubuntu startup, lançador/ícone, Android rolagem e defeitos de notificação descobertos após a entrega anterior. Testes de passagem anteriores não cobriram esses caminhos.
