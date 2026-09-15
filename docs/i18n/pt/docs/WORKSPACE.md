[English](../../../WORKSPACE.md) · [fr](../../fr/docs/WORKSPACE.md) · [es](../../es/docs/WORKSPACE.md) · [it](../../it/docs/WORKSPACE.md) · [pt](WORKSPACE.md) · [de](../../de/docs/WORKSPACE.md)

# Espaço de trabalho terminal partilhado

Cada shell pertence ao servidor host, não à janela que o criou. O aplicativo desktop, o aplicativo Android e os navegadores autorizados podem anexar ao mesmo PTY ao mesmo tempo. O tmux é opcional. Terminais existentes criados fora do jaunt não são adotados retroativamente; crie um jaunt shell ou anexe explicitamente uma sessão existente do tmux.

## Sessões e visualizações

**O novo shell** cria imediatamente um terminal com um nome automático, como o `bash 1`. Seu diretório segue o shell anteriormente ativo, incluindo alterações `cd` em hosts suportados. O ícone da pasta abre **Novo shell na pasta**, com navegação de diretório e um nome opcional. Se o SO não consegue ler o diretório atual do shell, o host usa o diretório inicial do shell.

Use **Sessões** ao lado das abas para ver cada sessão retida na máquina selecionada, incluindo sessões sem visão aberta. A lista mostra se cada shell está em execução e quais dispositivos estão abertos.

- ** Renomear** altera o nome da sessão compartilhada. Clique duas vezes em um nome da aba ou clique duas vezes em um título do painel para renomeá-lo também.
- **Open** liga este dispositivo ao shell existente e ao seu histórico retido.
- A aba **×** ou **Close view** detaches somente esta vista. O shell e outros clientes permanecem conectados.
- ** Terminar** pede confirmação, em seguida, termina o shell e seus trabalhos para todos os espectadores. Para tmux ele explicitamente mata essa sessão tmux, incluindo anexos fora do jaunt.

A terminação ordinária cobre processos na sessão do shell POSIX terminal, incluindo grupos de controle de tarefas de fundo. Um processo deliberadamente daemonizado em uma sessão separada do sistema operacional está fora desse limite. A terminação de sessão não é uma área de processamento/contentor geral.

O shells saído mantém seu status de espera até que a sessão seja removida, reservando o líder PID para que trabalhos de fundo sobreviventes ainda possam ser encerrados com segurança.

Fechar o aplicativo, perder uma conexão de rede ou bloquear seu cofre não termina o shells. As atualizações compatíveis do host mantêm processos comuns do shell e seu histórico por meio de uma substituição de tempo de execução no local. Um daemon explícito para/reinicia ou reinicializa ainda os termina. Hosts legados sem desativar as atualizações de adiamento enquanto shells normais estão ativos, a menos que o reinício seja explicitamente autorizado. tmux permanece disponível quando é necessária a persistência independente do reinício.

As páginas mantêm a sua ordem quando estão seleccionadas. Arraste- as para reordenar; num teclado, use Alt+Shift+Esquerda/direita. Carregue duas vezes em renomear; a manter uma página não abre o nome. Os grupos de partilha de área de trabalho e a ordem de tabulação móvel são retidos através de religações. A barra lateral da área de trabalho pode entrar em colapso e a sua preferência é salva.

## Dimensões compartilhadas e rolagem

Cada sessão tem um tamanho PTY. Clicar/ tocar ou digitar em uma visão faz com que o dispositivo controle seu tamanho. Redimensionar uma janela passiva não rouba o controle. Vistas passivas retêm a geometria compartilhada e podem rolar horizontal ou verticalmente quando o terminal do outro dispositivo é maior. Clique dentro dele para caber na tela.

O elemento interno medido do terminal não tem preenchimento; as margens de UI circundantes estão excluídas da sua contagem de linhas/colunas. O rodapé, as teclas de ação, as barras Android e o teclado reservam o seu próprio espaço. O botão ** ↓ Last** retorna à saída recente; a rolagem para cima permanece possível enquanto a saída continua. **Selecione** abre um controle de texto nativo para manipuladores de seleção móveis e copiando o texto retido do terminal. A seleção do mouse de desktop e Ctrl/Command+Shift+C permanecem disponíveis.

xterm 6 suporta saída sincronizada (modo DEC 2026). O comportamento de tela alternativa específico da aplicação ainda se aplica: a tela alternativa não é um buffer de rolagem ilimitado. Um programa terminal pode intencionalmente limpar sua própria tela ou optar por desativar seu próprio histórico. jaunt não reescreve as sequências de escape desse programa em saída fabricada.

## Páginas em ladrilhos

No ambiente de trabalho, os dois ícones separados escolhem lado a lado ou acima/ abaixo da colocação. O seu seletor em linha oferece um novo shell ou qualquer sessão fora do grupo de divisão actual. Arraste o separador, ou foque- o e use as teclas de setas. Cada página pode conter uma árvore dividida; a selecção de outra página preserva os grupos anteriores. O ícone ** Move pane para a sua própria página** em cada cabeçalho do painel separa- a sem terminar nenhuma sessão.

As disposições, as proporções, as vistas abertas, a ordem da máquina, os nomes amigos e a máquina por omissão são guardados no cofre deste dispositivo. Sobrevivem à reconexão e à reabertura da aplicação. No telemóvel, cada sessão num grupo dividido aparece como uma página normal; o regresso à largura da área de trabalho restaura a disposição da divisão. As preferências de disposição são por cliente, de modo que um dispositivo não reorganize o espaço de trabalho de outro dispositivo.

## Instalação do desktop e controles de host

O instalador do host gráfico instala o aplicativo de desktop para o usuário atual quando uma versão do desktop é anunciada. Os hosts existentes podem usar `jaunt gui` para instalar/abrir, ou `jaunt gui --install-only` para adicionar o lançador de aplicativos sem abrir uma janela. Pacotes Linux e aplicativos macOS também são fornecidos na versão do desktop. O aplicativo é chamado **jaunt** e usa a obra de arte fornecida.

A interface desktop é a mesma interface empacotada que o cliente web, com um grupo de configurações adicional **Este computador**: instalar/atualizar o host, iniciá-lo, instalar seu serviço de login, emparelhar outro dispositivo, e explicitamente autorizar uma atualização/reiniciar. Ele também pode emparelhar com outros hosts como um cliente normal. shells local são acessíveis através de um socket privado Unix da mesma conta sem precisar de uma conexão de relé; clientes remotos ainda autenticam através do relé criptografado.

Os arquivos de espaço de usuário Linux dependem do sistema que permite o espaço de usuário do Chromium. No Ubuntu restringindo esse mecanismo, o `jaunt gui` e o instalador gráfico selecionam automaticamente o pacote `.deb` e solicitam autorização do sistema, se necessário. O pacote configura seu perfil AppArmor. Os lançadores de produção nunca adicionam os artefatos de desktop `--no-sandbox`. O macOS não são assinados; os prompts de confiança do SO podem ser aplicados. Fechando a janela de desktop deixa o servidor e o shells em execução. As notificações de desktop exigem que o aplicativo de desktop permaneça em execução.

## Preferências e notificações

As configurações usam um ícone de engrenagem. Escuro é o padrão. Luz, Sistema e Circadian também estão disponíveis; Circadian usa luz das 07:00h às 19:00h no fuso horário local do dispositivo. As preferências de fonte do terminal permanecem compartilhadas entre os painéis desse cliente.

Cada host expõe os switches de eventos para sinos terminal, notificações de programas (OSC 9 e OSC 777) e saída de sessão. Esses switches afetam a geração de eventos do host. Habilite a entrega separadamente em cada cliente: notificações de fundo Android nativas, notificações Web Push do navegador ou notificações de sistema operacional desktop. `jaunt notify` e `jaunt run -- command` permanecem disponíveis para notificações explícitas e conclusão de comando individual. O shell não pode inferir de forma confiável a noção de “pensamento finalizado” de cada aplicativo.

Notificações omitem saída terminal por padrão. As permissões do navegador/OS, force-stop, políticas de bateria, disponibilidade de rede, e o host sendo on-line afetar a entrega de fundo. Nenhuma entrega garantida ou auditoria de segurança independente é reivindicada.

As notificações do programa preservam o texto da mensagem OSC 9 e o título/corpo OSC 777. Clicando em uma notificação nativa, seleciona sua máquina e sessão, incluindo após reconectar ou desbloquear. Android segue as configurações de privacidade do sistema operacional. A saída do terminal não é raspada para inventar o texto da notificação.

Os pictogramas de interface usam ícones de Lucide marcados e embalados localmente (licença ISC). A obra de arte jaunt fornecida continua a ser o logótipo da aplicação; os pacotes Linux incluem tamanhos de ícones padrão e o Android usa um invólucro de lançador adaptável em torno dessa obra de arte.

## Atualizações e progresso visível

O Host/CLI e as versões da área de trabalho são separadas. A máquina verifica automaticamente e espera pelo shells normal e as transferências para terminar antes de reiniciar. As verificações da área de trabalho na inicialização e a cada 15 minutos, verifica os downloads e instala quando a sua janela fecha. As configurações oferecem verificações manuais e Instala e reabre. A instalação da área de trabalho preserva as máquinas salvas da aplicação e não pára a máquina shells; os pacotes do sistema podem necessitar de um prompt de autorização do SO. O Android verifica o seu APK e assina a identidade antes de entregar a instalação ao Android.

A faixa de atividade permanece visível através da preparação da imagem, envio, verificação e inserção. A conclusão distingue um caminho inserido sem Enter de um PNG colocado na área de transferência da máquina com o Ctrl+V enviado. Ele nunca promete que um CLI específico tenha reconhecido um anexo. Atualizar as verificações de relatório atual, instalado, esperando pelo shells ativo ou falhou; os resultados completos/erros permanecem até serem rejeitados.

### Ícones de primeiro plano do programa

Tabs e legendas de painel usam os ícones de Meteor localmente empacotados Claude e OpenAI marcas enquanto o programa principal PTY possuído é `claude` ou `codex`. Detecção atualiza uma vez por segundo e envia apenas a categoria do programa, nunca argumentos de comando. Retornando para o shell restaura o ícone terminal. Nomes de sessão amigáveis não afetam a detecção. Sessões existentes tmux e wrappers não reconhecidos mantêm o ícone terminal. Ícones de Meteor 4.4.0 está licenciado; sua licença está incluída no pacote web.
