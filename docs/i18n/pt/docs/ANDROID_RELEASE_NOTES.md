[English](../../../ANDROID_RELEASE_NOTES.md) · [fr](../../fr/docs/ANDROID_RELEASE_NOTES.md) · [es](../../es/docs/ANDROID_RELEASE_NOTES.md) · [it](../../it/docs/ANDROID_RELEASE_NOTES.md) · [pt](ANDROID_RELEASE_NOTES.md) · [de](../../de/docs/ANDROID_RELEASE_NOTES.md)

# jaunt Android 0.1.0-beta.8

Esta atualização adiciona rolagem de toque com momento, preserva a posição de leitura através do redimensionamento do teclado, usa ícones de interface Lucide empacotados e usa o logotipo transparente original como seu ícone de lançador. Ele usa o original jaunt ícone, fornece o gerenciador de sessão compartilhada e temas, e recebe automático terminal Notificações de sino/programa/sessão-saída quando habilitadas. Os layouts de divisão de área de trabalho permanecem abas de sessão comuns em larguras móveis.

Esta versão regula a entrada rápida do terminal para evitar transbordar a fila de entrada limitada da máquina. A entrada pendente é descartada se os comandos criptografados mudarem; os comandos nunca são reproduzidos após a reconexão.

Instale o ativo `.apk` assinado abaixo no Android 8 ou mais recente. Permita a instalação do seu navegador quando o Android pedir, abra o jaunt e, em seguida, verifique o QR produzido pelo `jaunt pair` em seu host. Nenhum Android, GitHub ou Cloudflare conta é necessária para se conectar.

Este é um Android APK instalável com uma interface WebView empacotada e integrações nativas, não um PWA e não um Android UI inteiramente reescrito:

- Câmera nativa QR digitalização e seleção de galeria/arquivo.
- Android image/text boardboard access. Uma imagem colada é enviada e, quando a máquina tem uma área de transferência OS suportada, copiada para lá antes de enviar o Ctrl+V para o shell seleccionado, sem o Enter. As máquinas sem cabeça mantêm um retorno explícito de envio/caminho.
- A janela de Gravação do Sistema para transferências; o progresso verificado da transferência permanece disponível nos Ficheiros.
- Conexão de primeiro plano nativa opcional para notificações, incluindo enquanto o aplicativo está em segundo plano. Habilite-o em Configurações. A notificação Android persistente inclui Parar. Notificações exibem o título/corpo emitido por programas; tocando em um abre a sessão correspondente. As configurações de privacidade da tela de bloqueio Android ainda se aplicam.
- O pareamento salvo sobrevive às atualizações de aplicativos e às mudanças de rede. Chaves são excluídas do backup; identidades de serviço de fundo são criptografadas com o Android Keystore.

A máquina deve permanecer em execução; o instalador público de um comando configura o seu serviço de utilizador. O Android force- stop, as restrições da bateria, as interrupções da máquina/rede e o escalonamento do sistema operacional podem atrasar ou impedir as notificações. Isto não promete uma entrega garantida durante a inactividade profunda. O protocolo não foi submetido a uma auditoria de segurança independente.

O relatório de validação distingue o teste emulador do teste físico-telefone e a entrega exata da área de transferência/Ctrl+V do reconhecimento como um anexo dentro de uma determinada versão Claude Code/Codex. Veja `docs/ANDROID.md` e `docs/VALIDATION.md` na fonte marcada.

O APK verifica as atualizações automaticamente. As configurações também oferecem uma verificação imediata. Os downloads são verificados contra os checksums de liberação e a identidade de assinatura instalada antes de o Android pedir confirmação de instalação. As atualizações preservam dados e emparelhamentos de aplicativos; desinstalar os remove.

Os controles de sessão agora mantêm o Abrir, Renomear, Fechar e Terminar dentro de cada placa de sessão responsiva. O novo shell cria um terminal automaticamente chamado imediatamente. O novo shell na pasta oferece navegação de diretórios e um nome opcional. A máquina pode herdar o diretório atual do shell ativo. O desktop possui controles separados lado a lado e acima/abaixo/abaixo, uma escolha inline de sessões novas ou existentes, e um botão para mover cada painel para sua própria aba. O celular retém abas de sessão comuns. Fechando uma visão mantém o shell vivo; a terminação ainda requer confirmação explícita.

Interrupções de conexão agora compartilham um banner de status persistente. Resultados de aperto de mão assíncronos tardios não podem substituir uma conexão de substituição. Erros de diálogo permanecem em linha; erros de ação persistem sem cascatas de torradas. Transferências expõem espera/cancelamento/completação, colapsam atividade completa no histórico acessível e a disponibilidade de atualização mantém sua ação visível.

Esta versão adiciona seis linguagens de interface detectadas pelo sistema com uma página de sobreposição salva, arrastável estável com renomeação de duplo- clique, feedback de operação corrigido e ícones de primeiro plano do Claude/OpenAI localmente empacotados. A aplicação nativa abre o espaço de trabalho diretamente; a página inicial de apresentação está reservada para o site.
