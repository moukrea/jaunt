[English](../../../README.md) · [fr](../fr/README.md) · [es](../es/README.md) · [it](../it/README.md) · [pt](README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

** Seu shells, seus arquivos, sua máquina. Do seu telefone. **

jaunt fornece desktop nativo e aplicativos Android, um cliente web móvel/desktop e um host POSIX. Ele conecta você a terminais reais, incluindo shells arbitrário, Claude Code e Codex. O aplicativo web estático usa um relé compartilhado para realizar conexões criptografadas do host e cliente.

**Host: 0.1.0-beta.11 · Desktop: 0.1.0-beta.10 · Android: 0.1.0-beta.8.** [Open jaunt](https://moukrea.github.io/jaunt/). A publicação e validação da versão são rastreadas no relatório de validação. O protocolo não recebeu uma auditoria de segurança independente**. Veja o [último relatório de validação](docs/SEAMLESS_WORKSPACE_VALIDATION.md) para resultados de testes observados e limitações não validadas.

## Instalar a máquina

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Suporta Linux, macOS e WSL. Requer `curl`. O instalador usa um Python compatível 3.11–3.14 runtime ou instala um servidor privado Python runtime através do uv. O host instala sem privilégios de administrador. No Ubuntu com espaços de nomes de usuário restritos, o aplicativo de desktop opcional usa o instalador do pacote do sistema e pode solicitar uma senha de administrador para configurar sua caixa de areia. Ele verifica a liberação do SHA-256, cria um ambiente privado e inicia um serviço de usuário quando disponível. Atualizações automáticas estão habilitadas. Os hosts compatíveis mantêm seus processos shell durante a substituição de tempo de execução e aguardam transferências para terminar.

Ligado Android, [instalar a assinatura APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.8/jaunt-android-v0.1.0-beta.8.apk), em seguida, digitalizar o QR código exibido pela máquina. Em um desktop ou em um navegador, abra **https://moukrea.github.io/jaunt/**. Você também pode colar o `jaunt1.…` emparelhamento string. QR O código expira ao fim de dez minutos e só pode ser usado uma vez. Cada dispositivo recordado usa então a sua própria chave, de modo a alternar Wi-Fi ou redes móveis não requer emparelhamento novamente. Mantenha a guia aberta para reconexão automática; reabra o aplicativo se o sistema operacional móvel suspender ou matá-lo.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

Emparelhamento concede acesso como a ** conta do sistema que executa o host**, com todas as permissões dessa conta. Não execute como root para uso comum. Um código QR concede acesso shell: nunca publique.

## Características

Área □ Comportamento
|---|---|
□ Terminais □ Real PTYs, teclado interativo, múltiplas abas, criar/renomear/abrir/detacar/terminar, dimensionamento compartilhado, Ctrl/Alt/Esc/Tab/seta teclas
□ Reconexão □ Histórico fechado, reconexão automática, estado lembrado; uma desconexão do navegador não fecha o shell
Sessões existentes do tmux O Legacy tmux continua sendo suportado; novas sessões na UI são comuns compartilhadas do shells
Arquivos □ Navegação, arquivos ocultos, paginação, criar diretórios, renomear, exclusão não-recursiva, upload/download, visualização de texto/imagem
• Transferências • Progresso visível e resultados de sucesso/erro retidos; acompanhamento detalhado em Arquivos → atividade de transferência; 48 KiB blocos, offsets de currículo de rede, upload SHA-256, finalização atômica, cancelamento
□ Imagens Galeria, coletor de arquivos, colar e arrastar e soltar; Conversão de PNG para formatos decodíveis por navegador; inserção de caminho ou pasta nativa condicional
Área de transferência □ Selecção, cópia de rolagem retida, leitura/escrita da área de transferência da máquina quando disponível, buffer de texto sem cabeça, OSC 52 apenas para cópia
Proteção , código QR de uso único, chaves por dispositivo, revogação, opcional PIN / senha-protegido cofre do navegador e travamento automático ,
Notificações □ Nativo opcional Android serviço ou navegador Web Push; terminal sinos, eventos do programa, saída da sessão, teste de configurações e CLI `notify`/`run` |
Interface □ Ambiente de trabalho nativo e aplicativos Android com uma interface compartilhada empacotada; cliente do navegador; JavaScript local

## Apenas cliente de área de trabalho

Para se conectar a outras máquinas sem instalar um serviço de host local ou jaunt CLI:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Isto instala o mesmo aplicativo de desktop e lançador, com emparelhamento remoto, sessões, arquivos, notificações e atualizações automáticas de aplicativos. Ele não inicia um servidor ou mostra os controles da máquina local. Ele não desinstala uma máquina instalada anteriormente. Execute o comando de instalação da máquina normal para habilitar a integração da máquina local mais tarde.

O aplicativo de navegador instalado é nomeado **jaunt (PWA)** para que possa ser distinguido do aplicativo nativo **jaunt**. Ambos usam o logotipo transparente original. Android nativo usa a mesma arte sem um fundo escuro empacotado; lançadores individuais podem aplicar o seu próprio tratamento ícone.

## Espaço de trabalho compartilhado

Abra **jaunt** do menu de aplicativos da máquina ou execute `jaunt gui`. Host e clientes remotos compartilham o mesmo shells normal sem tmux. **New shell** abre um shell automaticamente chamado imediatamente, herdando o diretório atual do shell ativo anterior. O botão de pasta permite que você navegue pelos diretórios da máquina e, opcionalmente, nomeie o novo shell. **Sessões** lista as sessões em execução e saída: abra, renomeie, feche apenas a sua visão ou exclua explicitamente um shell para todos. Você também pode renomear uma aba clicando duas vezes no seu título ou clique duas vezes no título de um painel. Arrasta para reordená- los; selecionar uma aba nunca muda sua posição. O dispositivo que você interage com o terminal compartilhado.

Os dois ícones ** repartidos** organizam painéis lado a lado ou acima/ abaixo na área de trabalho, usando uma sessão nova ou existente. Cada painel pode mover- se para a sua própria página. As disposições sobrevivem à reabertura; os dispositivos móveis exibem as suas sessões como páginas normais. A barra lateral da área de trabalho pode entrar em colapso, com a preferência mantida. As opções incluem nomes de máquinas amigáveis, encomendas e a máquina por omissão, temas escuros/ claros/sistemas/circadianos e controlos de notificações. As opções da máquina seguem a máquina seleccionada imediatamente, incluindo os seus controlos de identidade e actualização. A aplicação de ecrã nativa também gere o serviço de máquina local e os pares para outras máquinas; os controlos de serviço locais aparecem apenas para a máquina local, enquanto as actualizações da aplicação de ecrã permanecem separadas. Veja o [workspace guide](docs/WORKSPACE.md)0XXQ e [validation report](docs/WORKSPACE_VALIDATION.md).

## Manipulação de imagens

O progresso permanece visível durante o envio e a entrega da área de transferência/caminho. As operações concluídas colapsam em um resultado compacto; **Mostrar o histórico** retém os detalhes. Cancelar uma transferência é mostrado como cancelamento, e os erros permanecem com a sua operação. O resultado final indica exatamente o que aconteceu; os erros permanecem visíveis com uma ação de repetição. Uma inserção de caminho bem sucedida ou entrega Ctrl+V não prova que Claude Code ou Codex reconheceram um anexo.

**Paste:** quando uma infra- estrutura nativa está disponível, uma imagem é enviada para a área de transferência do host e colada na sessão selecionada com Ctrl+V. Se o navegador retornar uma área de transferência vazia, a UI oferece uma área de pasta rica e um seletor de imagens. Anexar retém ambos os modos explícitos. Nenhuma chave Enter é enviada.

**Fallback com uma conexão ativa:** selecione ou cole uma imagem, carregue-a para o host, e insira seu caminho corretamente escapado no terminal. Nada envia o comando automaticamente. Claude, Codex, ou outra ferramenta pode ler o arquivo se seu próprio modo o suportar.

**Pasta nativa condicional:** quando o host tem uma área de transferência gráfica acessível (macOS, Wayland com `wl-clipboard`, ou X11 com `xclip`), jaunt coloca o PNG lá e envia Ctrl+V para a terminal. Isto também depende da CLI atalho e comportamento da ferramenta. ** Em uma máquina sem cabeça, jaunt não pode fabricar um Claude nativo /Codex anexo: ele cai de volta para um arquivo e seu caminho.** HEIC e outros formatos que o navegador não pode decodificar ainda pode ser transferido como arquivos, mas não são convertidos para PNG.

## Actualizações automáticas

O comportamento da atualização do componente do componente
|---|---|
□ Host / CLI □ Mesma instalação. Verifica o canal publicado a cada 15 minutos, verifica os downloads e substitui os tempos de execução compatíveis sem terminar os processos shell. As transferências terminam em primeiro lugar. As configurações ou as verificações `jaunt update` imediatamente. Hosts mais antigos sem diferimento de tempo de execução, enquanto o shells normal estão ativos; o fim desses shells ainda requer confirmação explícita.
O aplicativo Desktop . Separar versão do host. Verifica, baixa e verifica automaticamente uma atualização; instala quando você fecha o aplicativo. As configurações fornecem uma verificação manual, uma atualização automática alterna e ** Instalar e reabrir**. Atualizar a interface gráfica não impede o host ou o seu shells. Os pacotes do sistema podem solicitar autorização do sistema.
| Android APK □ Verifica automaticamente para um novo APK. Uma janela de verificação/download visível leva a AndroidConfirmação da instalação. APKSão verificados o somatório de verificação e o certificado de assinatura; Android não permite a auto-instalação silenciosa.
□ Cliente Web □ Usa a versão publicada em Páginas. Reabre/recarregue para ativar uma atualização de serviço-trabalhador baixado.

As instalações existentes precisam da versão que contém o seu updater antes que o updater possa ser executado. A repetição do comando host oficial actualiza a máquina e instala a aplicação de ecrã anunciada; recusa- se a fechar silenciosamente o shells normal activo. As teclas de emparelhamento são retidas. Veja [atualizações e reinicie a protecção](docs/UPDATES.md).

## Feedback de conexão e operação

Uma interrupção da rede tem um banner de conexão persistente com uma ação de repetição. O jaunt reconecta- se de novo com a chave do dispositivo gravada; não reproduz a entrada do terminal não enviada. A revogação e a verificação falhada da máquina interrompem a conexão e explicam o próximo passo. Erros numa janela permanecem nessa janela; outros erros de ação permanecem visíveis até serem descartados. Os brindes de confirmação curtos são desduplicados e limitados a dois.

Os envios, downloads, instalação de serviço e verificação de atualização mostram o progresso e um resultado final em Atividade. As pausas na rede são explícitas, o cancelamento de transferência está disponível e o histórico completo pode ser expandido. As atualizações disponíveis fornecem uma ação direta em vez de uma torrada expirante.

## Notificação

Habilitar notificações em **Configurações** e usar sua ação de teste. Títulos de notificação de programa e texto são preservados quando fornecido; um sino terminal simples não tem corpo de mensagem para recuperar. Clicar em uma notificação seleciona o host e sessão correspondente. As notificações de desktop exigem que o aplicativo esteja em execução; Android usa seu serviço de conexão de primeiro plano opcional; o cliente web usa o navegador Web Push. Conteúdo de notificação pode aparecer na tela de bloqueio de acordo com as configurações do sistema operacional.

## Limitações conhecidas

- Até 16 shells ativos, 32 visualizações retidas, 2 MiB de replay bruto por PTY, e 10.000 linhas de rolagem xterm. Copy-all cobre o histórico retido, não um log ilimitado.
- Limite de arquivo host: 512 MiB. Os downloads em memória são limitados a 128 MiB em navegadores sem escrita direta de arquivo; pré-visualizações são limitadas a 16 MiB. Até oito uploads simultâneos e 1 GiB de tamanho total declarado.
- Os envios retomam após interrupções da rede enquanto o host e a página retêm a transferência. Reinicie o upload após o reinício de uma máquina ou recarregue a página inteira; jaunt não obtém acesso persistente não autorizado aos arquivos locais do telefone.
- shells comum sobreviver à desconexão e atualizações de tempo de execução compatíveis, ** não um daemon explícito parar / reiniciar ou reinicialização da máquina**. tmux pode sobreviver a um reinício do daemon, mas não a uma reinicialização do sistema operacional.
- Apenas uma guia de aplicação jaunt por perfil do navegador pode possuir o cofre de cada vez. Várias abas terminal dentro do jaunt e vários dispositivos são suportados.
- As notificações de navegador requerem permissão e suporte ao Web Push. No APK, habilite as notificações de fundo do Android em Configurações; as restrições de bateria do Android podem atrasar a entrega. No iOS, use o PWA instalado. A entrega depende da rede e do provedor de push; não é garantida em tempo real.
- Uma máquina adormecida ou desligada não é acessível. Não existe qualquer despertar remoto, túnel TCP arbitrário, área de trabalho gráfica ou nativo Windows shell apoio.
- Os pacotes de desktop Linux estão disponíveis para x64 e ARM64; os arquivos macOS não estão assinados e não estão anotados. Nenhum pacote de desktop Windows nativo é fornecido. O comportamento físico do telefone Android e a autorização protegida do updater macOS não foram validadas; os resultados do emulador são documentados separadamente.
- Custos de relé de produção, quotas e disponibilidade dependem da conta Cloudflare. As salvaguardas básicas de relé não são um serviço de proteção contra abuso comercial garantido.

## Desenvolvimento local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

O corredor escuta apenas no `127.0.0.1`, inicia um relé local e host, e exibe um código de teste QR. **Isso não expõe o host à Internet.** Use a implantação do HTTPS em um telefone físico: `localhost` refere-se ao telefone, não ao PC.

```sh
pytest -q                        # Python tests and Node interoperability tests
npm test                         # Relay model, protocol/UI helpers and desktop updater
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
python tests/shared_workspace_e2e.py # Electron + browser sharing real PTYs; needs a display
python tests/terminal_render_e2e.py  # Scroll, selection and terminal geometry
python tests/installer_e2e.py        # Real wheel install and protected upgrade
```

Defina o `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` para usar um navegador de sistema. Caso contrário, execute o `python -m playwright install chromium`. Os testes nunca alteram as políticas de segurança do seu navegador.

## Implementação inicial — uma vez, pelo proprietário do projecto

Dê [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) a um agente com acesso GitHub. Ele configura Páginas GitHub, uma versão host, e ** um relé Cloudflare para todo o projeto**. É necessária autorização Cloudflare; um token GitHub não o fornece. Usuários finais não criam infraestrutura.

O jaunt não empresta relés do sshx, Happy ou Zedra. Ele não depende de seus servidores, Tailscale ou de uma conta de usuário do jaunt. A conta Cloudflare do proprietário pode incorrer em cotas ou custos; nenhum relé gratuito ou ilimitado é prometido.

## Documentação

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Edifícios de terceiros](../../../THIRD_PARTY_NOTICES.md)

Inglês é o idioma de documentação canônica. Traduções: [Français](../fr/README.md), [Español](../es/README.md), [Italiano](../it/README.md), [Português](README.md), [Deutsch](../de/README.md)Cada árvore traduzida inclui os guias de segurança, implantação e validação.

Web, Android e desktop selecione a linguagem do sistema automaticamente. Sobrescrever em **Configurações → Idioma**. O CLI usa o locale do sistema; `jaunt --language fr --help` substitui uma invocação e `jaunt language fr` salva a preferência. Use `system` para restaurar a seleção automática. Nomes de comando, argumentos, saída terminal e conteúdo do usuário nunca são traduzidos.

O endereço web público introduz o projeto; **Open workspace** entra no cliente. Aplicativos nativos abrem o espaço de trabalho diretamente.

## Aplicativo Android

O cliente Android é um APK com uma interface WebView empacotada e integrações de área de transferência nativa, câmera, arquivo e notificação de fundo. Veja [Android installation, architecture, and validation](docs/ANDROID.md). A página anuncia o APK depois que seus ativos públicos foram verificados.

O APK é um pacote Android nativo com um pacote WebView, não uma instalação PWA. A interface e tipografia são compartilhadas com os aplicativos web e desktop; a integração nativa fornece câmera, área de transferência, seleção de arquivos e notificações. Veja a tabela de atualização acima para os requisitos de confirmação de instalação.
