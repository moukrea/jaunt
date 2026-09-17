[English](../../../README.md) · [fr](../fr/README.md) · [es](../es/README.md) · [it](../it/README.md) · [pt](README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**As suas máquinas, as suas shells, os seus ficheiros. Em todos os ecrãs.**

O jaunt liga os dispositivos que traz consigo às máquinas onde trabalha. Instale um pequeno host em cada máquina Linux ou macOS, emparelhe o telemóvel, o portátil ou o computador de secretária uma única vez, e todos passam a mostrar o mesmo espaço de trabalho: shells reais em PTYs reais, os ficheiros ao lado delas e as sessões que deixou a correr. Abra, renomeie, divida, reordene, feche ou termine shells em qualquer host a partir de qualquer dispositivo; com as *sessões abertas partilhadas* ativas, os mesmos separadores, painéis e shell ativa acompanham-no de ecrã para ecrã. O Claude Code e o Codex correm ali como qualquer outro programa e, quando ambos estão instalados num host, um único interruptor permite que as suas sessões no mesmo projeto se conheçam e troquem mensagens. Clientes: um navegador (também instalável como PWA), uma aplicação Android nativa e uma aplicação de secretária nativa; as três trazem a mesma interface. As ligações saem do host através de um relay, cifradas de ponta a ponta, sem porta aberta, sem VPN e sem conta.

**Host: 0.1.0-beta.26 · Desktop: 0.1.0-beta.20 · Android: 0.1.0-beta.18.** [Abrir o jaunt](https://moukrea.github.io/jaunt/). A publicação e a validação das versões são acompanhadas no relatório de validação. O protocolo **não foi submetido a uma auditoria de segurança independente**. Consulte o [relatório de validação mais recente](docs/SEAMLESS_WORKSPACE_VALIDATION.md) para os resultados de teste observados e as limitações ainda não validadas.

## Instalar o host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Suporta Linux, macOS e WSL. Requer `curl`. O instalador utiliza um runtime Python 3.11–3.14 compatível ou instala um runtime Python privado através do uv. O host instala-se sem privilégios de administrador. No Ubuntu com namespaces de utilizador restritos, a aplicação de secretária opcional recorre ao instalador de pacotes do sistema e pode pedir a palavra-passe de administrador para configurar a sua sandbox. O instalador verifica o SHA-256 da versão, cria um ambiente privado e inicia um serviço de utilizador quando disponível. As atualizações automáticas ficam ativas. Os hosts compatíveis conservam os processos das shells durante a substituição do runtime e aguardam que as transferências terminem.

No Android, [instale o APK assinado](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.18/jaunt-android-v0.1.0-beta.18.apk) e depois leia o código QR apresentado pelo host. Num computador de secretária ou num navegador, abra **https://moukrea.github.io/jaunt/**. Também pode colar a cadeia de emparelhamento `jaunt1.…`. O código QR expira ao fim de dez minutos e só pode ser usado uma vez. Cada dispositivo memorizado passa depois a usar a sua própria chave, pelo que mudar de rede Wi-Fi ou móvel não obriga a emparelhar de novo. Mantenha o separador aberto para a religação automática; reabra a aplicação se o sistema operativo móvel a suspender ou terminar.

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

O emparelhamento concede acesso como a **conta de sistema que executa o host**, com todas as permissões dessa conta. Não execute como root para uso corrente. Um código QR concede acesso a uma shell: nunca o publique.

## Funcionalidades

| Área | Comportamento |
|---|---|
| Hosts | Emparelhe tantas máquinas Linux/macOS quantas quiser; cada uma conserva as suas sessões, ficheiros, definições e nome amigável; mude de máquina a partir de uma única barra lateral; host predefinido e ordenação |
| Terminais | PTYs reais com a sua própria shell, teclado interativo, separadores, criar/renomear/abrir/desligar/terminar, arrastar para reordenar, painéis divididos (lado a lado ou empilhados), dimensionamento partilhado, teclas Ctrl/Alt/Esc/Tab/setas em mobile, caixa de composição para entradas longas |
| Sessões abertas partilhadas | Por host: todos os clientes e o próprio host mostram os mesmos separadores, painéis, ordem e shell ativa; modo opcional «só existem as sessões apresentadas» |
| Religação | Histórico limitado, religação automática, estado memorizado; uma desconexão do navegador não fecha a shell; as shells sobrevivem às atualizações do host no local |
| Sessões tmux existentes | As sessões tmux antigas continuam suportadas; as novas sessões na interface são shells partilhadas normais |
| Ficheiros | Navegação, ficheiros ocultos, paginação, criação de diretórios, renomear, eliminação não recursiva, envio/transferência, pré-visualização de texto e imagens |
| Transferências | Progresso visível e resultados de sucesso/erro conservados; acompanhamento detalhado em Ficheiros → Atividade de transferência; blocos de 48 KiB, retoma a partir do ponto de interrupção da rede, SHA-256 no envio, finalização atómica, cancelamento |
| Imagens | Galeria, seletor de ficheiros, colar e arrastar e largar; conversão para PNG dos formatos que o navegador consegue descodificar; inserção do caminho ou colagem nativa condicional |
| Área de transferência | Seleção, cópia do histórico conservado, leitura/escrita da área de transferência do host quando disponível, buffer de texto para hosts sem ambiente gráfico, OSC 52 apenas para cópia |
| Claude Code ↔ Codex | Um interruptor por host: as sessões no mesmo projeto conhecem-se através dos respetivos hooks e podem enviar mensagens para a conversa aberta uma da outra; desligar remove tudo o que o jaunt adicionou |
| Proteção | Códigos QR de utilização única, chaves por dispositivo, revogação, cofre do navegador opcionalmente protegido por PIN/palavra-passe e bloqueio automático |
| Notificações | Serviço Android nativo opcional ou Web Push do navegador; sinos de terminal, eventos de programas, fim de sessão, teste nas Definições e `notify`/`run` na CLI |
| Interface | Aplicações nativas de secretária e Android com uma interface empacotada comum; cliente de navegador e PWA; seis idiomas; temas escuro, claro, do sistema e circadiano |
| Atualizações | O host substitui-se a si próprio no local sem terminar as shells; a aplicação de secretária e o APK verificam, validam e instalam as suas próprias atualizações |

## Apenas o cliente de secretária

Para se ligar a outros hosts sem instalar um serviço de host local nem a CLI do jaunt:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Isto instala a mesma aplicação de secretária e o mesmo lançador, com emparelhamento remoto, sessões, ficheiros, notificações e atualizações automáticas da aplicação. Não inicia nenhum daemon nem mostra os controlos do host local. Não desinstala um host instalado anteriormente. Para ativar mais tarde a integração com o host local, execute o comando normal de instalação do host.

A aplicação de navegador instalada chama-se **jaunt (PWA)** para se distinguir da aplicação nativa **jaunt**. Ambas usam o logótipo transparente original. No Android nativo usa-se a mesma imagem sem fundo escuro incorporado; cada lançador pode aplicar o seu próprio tratamento ao ícone.

## Espaço de trabalho partilhado

Abra o **jaunt** a partir do menu de aplicações do host ou execute `jaunt gui`. O host e os clientes remotos partilham as mesmas shells normais, sem tmux. **Nova shell** abre de imediato uma shell com nome automático, herdando o diretório atual da shell ativa anterior. O botão de pasta permite percorrer os diretórios do host e, opcionalmente, dar um nome à nova shell. **Sessões** lista as sessões em execução e as terminadas: abrir, renomear, fechar apenas a sua vista ou terminar explicitamente uma shell para todos. Também pode renomear um separador com um duplo clique no título, ou fazer duplo clique no título de um painel. Arraste os separadores para os reordenar; selecionar um separador nunca lhe altera a posição. O dispositivo com que interage é o que controla o tamanho do terminal partilhado.

Os dois **ícones de divisão** dispõem os painéis lado a lado ou um sobre o outro na versão de secretária, com uma sessão nova ou existente. Cada painel pode passar para o seu próprio separador. As disposições sobrevivem à reabertura; em mobile, as sessões aparecem como separadores normais. A barra lateral da versão de secretária pode ser recolhida, e a preferência é conservada. As Definições incluem os nomes amigáveis dos hosts, a ordenação e o host predefinido, os temas escuro/claro/do sistema/circadiano e os controlos de notificações. As definições do host acompanham de imediato a máquina selecionada, incluindo a sua identidade e os controlos de atualização. A aplicação de secretária nativa também gere o serviço do host local e emparelha com outros hosts; os controlos do serviço local só aparecem para o host local, e as atualizações da própria aplicação de secretária permanecem separadas. Consulte o [guia do espaço de trabalho](docs/WORKSPACE.md) e o [relatório de validação](docs/WORKSPACE_VALIDATION.md).

**Ponte Claude Code ↔ Codex.** Quando `claude` e `codex` estão ambos instalados num host, as Definições mostram um interruptor. Uma vez ligado, as sessões reais de Claude Code e Codex abertas em shells do jaunt no mesmo projeto passam a conhecer-se automaticamente (como contexto normal de hooks) e podem enviar mensagens para a conversa aberta uma da outra, a seu pedido ou por iniciativa própria. Está desligado por omissão; desligá-lo remove tudo o que o jaunt adicionou aos dois runtimes. Consulte o [guia da ponte](../../../docs/BRIDGE.md).

## Tratamento de imagens

O progresso mantém-se visível durante o envio e a entrega pela área de transferência ou pelo caminho. As operações concluídas contraem-se num resultado compacto; **Mostrar histórico** conserva os detalhes. O cancelamento de uma transferência é apresentado como cancelamento, e os erros ficam associados à respetiva operação. O resultado final indica exatamente o que aconteceu; os erros permanecem visíveis, com uma ação para tentar de novo. Uma inserção de caminho ou uma entrega por Ctrl+V bem-sucedida não prova que o Claude Code ou o Codex tenham reconhecido um anexo.

**Colar:** quando existe um backend nativo disponível, a imagem é enviada para a área de transferência do host e colada na sessão selecionada com Ctrl+V. Se o navegador devolver uma área de transferência vazia, a interface oferece uma zona de colagem enriquecida e um seletor de imagens. Anexar conserva os dois modos explícitos. Nunca é enviada a tecla Enter.

**Alternativa com ligação ativa:** selecione ou cole uma imagem, envie-a para o host e insira no terminal o seu caminho devidamente escapado. Nada submete o comando automaticamente. O Claude, o Codex ou outra ferramenta podem ler o ficheiro se o seu próprio modo o permitir.

**Colagem nativa condicional:** quando o host dispõe de uma área de transferência gráfica acessível (macOS, Wayland com `wl-clipboard` ou X11 com `xclip`), o jaunt coloca lá o PNG e envia Ctrl+V ao terminal. Isto depende igualmente do atalho e do comportamento da ferramenta de linha de comandos. **Num host sem ambiente gráfico, o jaunt não consegue fabricar um anexo nativo do Claude/Codex: recorre a um ficheiro e ao seu caminho.** O HEIC e outros formatos que o navegador não consegue descodificar podem, ainda assim, ser transferidos como ficheiros, mas não são convertidos para PNG.

## Atualizações automáticas

| Componente | Comportamento de atualização |
|---|---|
| Host / CLI | Mesma instalação. Verifica o canal publicado a cada 15 minutos, valida as transferências e substitui os runtimes compatíveis sem terminar os processos das shells. As transferências terminam primeiro. As Definições ou `jaunt update` fazem a verificação de imediato. Os hosts mais antigos, sem passagem de testemunho do runtime, adiam a atualização enquanto houver shells normais ativas; terminar essas shells continua a exigir confirmação explícita. |
| Aplicação de secretária | Versão separada da do host. Verifica, transfere e valida automaticamente uma atualização; instala-a quando fecha a aplicação. As Definições oferecem uma verificação manual, um interruptor de atualização automática e **Instalar e reabrir**. Atualizar a interface gráfica não pára o host nem as suas shells. Os pacotes de sistema podem pedir autorização ao sistema operativo. |
| APK Android | Verifica automaticamente se existe um novo APK. Um diálogo visível de verificação/transferência conduz à confirmação de instalação do Android. A soma de verificação e o certificado de assinatura do APK são validados; o Android não permite a autoinstalação silenciosa. |
| Cliente web | Usa a versão publicada no Pages. Reabra ou recarregue para ativar uma atualização do service worker já transferida. |

As instalações existentes precisam da versão que contém o respetivo atualizador antes de este poder correr. Voltar a executar o comando oficial do host atualiza o host e instala a aplicação de secretária anunciada; recusa-se a fechar silenciosamente shells normais ativas. As chaves de emparelhamento são conservadas. Consulte [atualizações e proteção contra reinícios](docs/UPDATES.md).

## Feedback de ligação e de operações

Uma interrupção da rede produz um único aviso de ligação persistente, com uma ação para tentar de novo. O jaunt religa-se com a chave de dispositivo guardada; não reenvia entradas de terminal que não tenham chegado a ser enviadas. A revogação e a falha de verificação do host interrompem a ligação e explicam o passo seguinte. Os erros num diálogo ficam nesse diálogo; os erros de outras ações permanecem visíveis até serem dispensados. As notificações curtas de confirmação são desduplicadas e limitadas a duas.

Os envios, as transferências, a instalação do serviço e as verificações de atualização mostram o progresso e um resultado final em Atividade. As pausas da rede são explícitas, o cancelamento de transferências está disponível e o histórico concluído pode ser expandido. As atualizações disponíveis oferecem uma ação direta em vez de uma notificação que expira.

## Notificações

Ative as notificações nas **Definições** e use a respetiva ação de teste. Os títulos e o texto das notificações de programas são preservados quando fornecidos; um simples sino de terminal não tem corpo de mensagem a recuperar. Clicar numa notificação seleciona o host e a sessão correspondentes. As notificações de secretária exigem que a aplicação esteja em execução; o Android usa o seu serviço de ligação em primeiro plano opcional; o cliente web usa o Web Push do navegador. O conteúdo das notificações pode aparecer no ecrã de bloqueio, consoante as definições do sistema operativo.

## Limitações conhecidas

- Até 16 shells ativas, 32 vistas conservadas, 2 MiB de replay em bruto por PTY e 10 000 linhas de histórico no xterm. A cópia integral abrange o histórico conservado, não um registo ilimitado.
- Limite de ficheiro no host: 512 MiB. As transferências em memória estão limitadas a 128 MiB nos navegadores sem escrita direta em ficheiro; as pré-visualizações estão limitadas a 16 MiB. Até oito envios em simultâneo e 1 GiB de tamanho total declarado.
- Os envios são retomados após interrupções da rede enquanto o host e a página conservarem a transferência. Reinicie o envio depois de um reinício do host ou de um recarregamento completo da página; o jaunt não obtém acesso persistente não autorizado aos ficheiros locais do telemóvel.
- As shells normais sobrevivem a desconexões e a atualizações compatíveis do runtime, **mas não a uma paragem ou reinício explícito do daemon nem a um reinício da máquina**. O tmux pode sobreviver a um reinício do daemon, mas não a um reinício do sistema operativo.
- Só um separador da aplicação jaunt por perfil de navegador pode deter o cofre de cada vez. Vários separadores de terminal dentro do jaunt e vários dispositivos são suportados.
- As notificações no navegador exigem permissão e suporte de Web Push. No APK, ative as notificações em segundo plano do Android nas Definições; as restrições de bateria do Android podem atrasar a entrega. No iOS, use a PWA instalada. A entrega depende da rede e do fornecedor de push; não é garantida em tempo real.
- Um host em suspensão ou desligado fica inacessível. Não existe despertar remoto, túnel TCP arbitrário, ambiente de trabalho gráfico nem suporte de shell nativa do Windows.
- Os pacotes de secretária para Linux estão disponíveis para x64 e ARM64; os arquivos para macOS não são assinados nem notarizados. Não é fornecido nenhum pacote de secretária nativo para Windows. O comportamento em telemóveis Android físicos e a autorização protegida do atualizador no macOS não foram validados; os resultados em emulador estão documentados à parte.
- Os custos, as quotas e a disponibilidade do relay de produção dependem da conta Cloudflare. As salvaguardas básicas do relay não constituem um serviço comercial garantido de proteção contra abusos.

## Desenvolvimento local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

O runner escuta apenas em `127.0.0.1`, inicia um host e um relay local e apresenta um código QR de teste. **Isto não expõe o host à Internet.** Num telemóvel físico, use a implantação HTTPS: `localhost` refere-se ao telemóvel, não ao PC.

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
python tests/client_update_e2e.py    # Browser-driven host self-update, pushed progress, refusal of a broken release
python tests/bridge_e2e.py           # Real Claude Code and Codex sessions discover and message each other through the bridge (uses your real accounts)
python tests/workspace_sync_e2e.py   # Shared open sessions between two clients, close-or-terminate choice, displayed-only mode
```

Defina `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` para usar um navegador do sistema. Caso contrário, execute `python -m playwright install chromium`. Os testes nunca alteram as políticas de segurança do seu navegador.

## Implantação inicial — uma única vez, pelo responsável do projeto

Entregue o [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) a um agente com acesso ao GitHub. Ele configura o GitHub Pages, uma versão do host e **um único relay Cloudflare para todo o projeto**. É necessária autorização na Cloudflare; um token do GitHub não a fornece. Os utilizadores finais não criam infraestrutura.

O jaunt não reutiliza os relays do sshx, do Happy nem do Zedra. Não depende dos servidores deles, do Tailscale nem de uma conta de utilizador jaunt. A conta Cloudflare do responsável pode estar sujeita a quotas ou custos; não é prometido nenhum relay gratuito nem ilimitado.

## Documentação

[Implantação](docs/DEPLOYMENT.md) · [Segurança](SECURITY.md) · [Protocolo](docs/PROTOCOL.md) · [Resolução de problemas](docs/TROUBLESHOOTING.md) · [Validação](docs/VALIDATION.md) · [Avisos de terceiros](../../../THIRD_PARTY_NOTICES.md)

O inglês é a língua canónica da documentação. Traduções: [Français](../fr/README.md), [Español](../es/README.md), [Italiano](../it/README.md), [Português](README.md), [Deutsch](../de/README.md). Cada árvore traduzida inclui os guias de segurança, implantação e validação.

A web, o Android e a versão de secretária selecionam automaticamente o idioma do sistema. Pode alterá-lo em **Definições → Idioma**. A CLI usa a localização do sistema; `jaunt --language fr --help` altera uma única invocação e `jaunt language fr` guarda a preferência. Use `system` para repor a seleção automática. Os nomes dos comandos, os argumentos, a saída do terminal e o conteúdo do utilizador nunca são traduzidos.

O endereço web público apresenta o projeto; **Abrir área de trabalho** entra no cliente. As aplicações nativas abrem o espaço de trabalho diretamente.

## Aplicação Android

O cliente Android é um APK com uma interface WebView incorporada e integrações nativas de área de transferência, câmara, ficheiros e notificações em segundo plano. Consulte [instalação, arquitetura e validação no Android](docs/ANDROID.md). A página anuncia o APK depois de os seus recursos públicos terem sido verificados.

O APK é um pacote Android nativo com uma WebView incorporada, não uma instalação PWA. A interface e a tipografia são partilhadas com as aplicações web e de secretária; a integração nativa fornece a câmara, a área de transferência, a seleção de ficheiros e as notificações. Consulte a tabela de atualizações acima para os requisitos de confirmação da instalação.
