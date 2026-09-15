[English](../../../DESKTOP_RELEASE_NOTES.md) · [fr](../../fr/docs/DESKTOP_RELEASE_NOTES.md) · [es](../../es/docs/DESKTOP_RELEASE_NOTES.md) · [it](../../it/docs/DESKTOP_RELEASE_NOTES.md) · [pt](DESKTOP_RELEASE_NOTES.md) · [de](../../de/docs/DESKTOP_RELEASE_NOTES.md)

# Área de trabalho jaunt 0. 1. 0- beta. 10

Um aplicativo de desktop nativo que compartilha a mesma interface de resposta que o navegador e o cliente Android, com controles de host locais. Dispositivos locais e remotos anexam ao mesmo shells comum sem tmux. Páginas de desktop suportam painéis de divisão persistentes e redimensionáveis; layouts móveis mostram essas sessões como abas separadas.

**Sessions** lista sessões em execução e encerradas, abre shells existente, fecha apenas uma visão, ou termina explicitamente um shell e seus trabalhos para todos os espectadores. Clicando ou digitando seleciona qual dispositivo controla o tamanho compartilhado terminal.

O aplicativo usa a arte original do jaunt, temas escuros/claros/sistemas/circadianos, nomes de host amigáveis/ordem/defaults e notificações privadas opcionais. Ele pode iniciar um serviço de host instalado e se conectar a outras máquinas. O instalador oficial também oferece `--client-only`, que instala o cliente de desktop sem um host local ou controles de host locais.

Linux: instalar o `.deb` ou `.rpm`, ou usar o `jaunt gui` para uma instalação de arquivo verificada por usuário. macOS: abrir o arquivo/disco de aplicativos da CPU correspondente, ou usar o `jaunt gui` de um host instalado. As construções do desktop não são assinadas no macOS. Nenhum lançador desabilita a caixa de areia do Chromium. As notificações exigem que o aplicativo esteja rodando.

O protocolo não recebeu uma auditoria de segurança independente. Veja `docs/WORKSPACE.md` e `docs/WORKSPACE_VALIDATION.md` para comportamento, testes observados e limites de validação remanescentes.

Esta atualização substitui pictogramas de interface com Lucide, exibe o texto de notificação do programa e mantém os alvos de notificação através de religações. Os pacotes Linux contêm tamanhos padrão de ícone-tema e metadados de lançamento legíveis. No Ubuntu com espaços de nomes de usuário restritos, o instalador do host seleciona o pacote do sistema para configurar o suporte à sandbox.

Os controles de sessão agora mantêm o Abrir, Renomear, Fechar e Terminar dentro de cada placa de sessão responsiva. O novo shell cria um terminal automaticamente chamado imediatamente. O novo shell na pasta oferece navegação de diretórios e um nome opcional. A máquina pode herdar o diretório atual do shell ativo. O desktop possui controles separados lado a lado e acima/abaixo/abaixo, uma escolha inline de sessões novas ou existentes, e um botão para mover cada painel para sua própria aba. O celular retém abas de sessão comuns. Fechando uma visão mantém o shell vivo; a terminação ainda requer confirmação explícita.

A aplicação de ecrã verifica agora as actualizações automaticamente, baixa e verifica a versão correspondente e instala- a quando fecha a aplicação. As opções oferecem Verificar a actualização da área de trabalho, uma actualização automática comuta e Instalar e reabrir quando estiver pronto. As instalações do sistema podem pedir autorização do sistema. Esta actualização da interface separadamente da máquina e não impede a máquina shells. Os envios e as verificações de actualização mostram agora o progresso visível e um resultado retido em vez de apenas um brinde inicial.

Interrupções de conexão agora compartilham um banner de status persistente. Resultados de aperto de mão assíncronos tardios não podem substituir uma conexão de substituição. Erros de diálogo permanecem em linha; erros de ação persistem sem cascatas de torradas. Transferências expõem espera/cancelamento/completação, colapsam atividade completa no histórico acessível e a disponibilidade de atualização mantém sua ação visível.

Esta versão corrige a disposição de Configurações, a ordenação de tabulações estáveis, o renomeamento de duplo- click, o feedback de reconexão/ atualização e a ancoragem de rolagem móvel. Ele adiciona uma barra lateral colapsada persistente e seis idiomas detectados pelo sistema com uma sobreposição explícita. O título da janela é simplesmente `jaunt`. As sessões de primeiro plano de Claude e Codex usam ícones de marca Meteor localmente empacotados.
