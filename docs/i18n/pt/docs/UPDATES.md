[English](../../../UPDATES.md) · [fr](../../fr/docs/UPDATES.md) · [es](../../es/docs/UPDATES.md) · [it](../../it/docs/UPDATES.md) · [pt](UPDATES.md) · [de](../../de/docs/UPDATES.md)

# Atualizações sem perder sessões ou identidades

## Máquina

O instalador público configura as actualizações automáticas por omissão. A máquina verifica a versão seleccionada pela Página publicada após a inicialização e a cada 15 minutos. Isto mantém- a no canal de implantação validado pelo proprietário. Uma verificação de código- fonte não tem nenhuma autoridade de instalação automática; tem de ser inicialmente instalada através do instalador público.

Uma nova roda é baixada sobre o HTTPS e verificada contra o seu manifesto de lançamento. O instalador é lido a partir dessa roda verificada. Os hosts compatíveis substituem os descritores Python runtime no local com `exec`: o daemon PID, o filho shell processos e PTY abertos permanecem vivos. O buffer de reprodução limitado e a geometria terminal passam por um descritor de arquivo privado não ligado. As variáveis de ambiente de shell, diretórios de trabalho e comandos em execução permanecem em seus processos originais. Os clientes reconectam- se usando suas chaves existentes. Isto não requer tmux.

Transferências de arquivos adiam a instalação até que terminem. O instalador valida o novo tempo de execução antes de solicitar a transferência e pára de aceitar novas sessões durante o switch. Se a preparação falhar, a antiga máquina retoma o serviço do shells existente. O modo automático nunca herda o `jaunt_ALLOW_RESTART` ou o download do desenvolvedor sobrepõe- se.

**Migração de hosts mais antigos:** as versões sem transferência de tempo de execução não podem preservar o PTYs através de uma substituição de tempo de execução. O instalador detecta que a capacidade e o adiamento enquanto o shells normal estão ativos. Terminando- as ainda requer aprovação explícita através de **Atualizar e reiniciar** ou `jaunt update --allow-restart`. Um `jaunt update` comum nunca concede essa permissão. Após esta migração única, as atualizações compatíveis subsequentes usam o handoff automaticamente.

As configurações seguem a atualização através de seu progresso e reconexão automaticamente. As atualizações da aplicação preservam shells; explicitamente parando/reiniciando o daemon ou reiniciando o computador ainda termina o shells normal. Este mecanismo não é recuperação após uma falha ou perda de energia do daemon.

O atualizador desapegado usa um bloqueio privado para evitar sobreposições de atualizações e retém o tempo de execução antigo até que a substituição verificada esteja pronta. Registros de identidade e dispositivo do host são preservados. Private `installation.json`, `update-status.json`, `update.log` e rodas encenadas nunca liberam ativos. Verificações falhadas não revogam dispositivos.

## Android

O APK verifica as versões públicas do Android automaticamente, com uma verificação manual em Configurações. Verifica os bytes baixados, a identidade do pacote, uma versão estritamente mais recente e o mesmo certificado de assinatura antes de abrir o instalador do Android. Os dados e o pareamento das aplicações são retidos durante uma atualização. O Android requer confirmação do usuário para a instalação do APK e pode pedir uma vez a permissão para instalar atualizações do jaunt. Este é um limite do sistema operacional, não um serviço de nuvem ausente ou uma conta de usuário final.

Veja [Android detalhes e validação](ANDROID.md). Controles de atualização, verificações de assinatura e testes funcionais não constituem uma auditoria de segurança independente.

## Aplicação de área de trabalho

A interface de trabalho tem a sua própria versão de lançamento e updater, separada do host/CLI. Verifica o canal publicado logo após a inicialização e a cada 15 minutos, seleciona o pacote Linux/macOS para a CPU atual, e verifica o SHA-256 após o download e novamente antes da instalação. As configurações fornecem uma verificação manual e um botão de atualização automática.

Uma linha de atividade visível segue a verificação, download, verificação, prontidão e erros. **Instalar e reabrir** aplica um pacote verificado e reabre o mesmo perfil de aplicação. Com as atualizações automáticas habilitadas, fechar o aplicativo também aplica uma atualização pronta. shellsUm sistema `.deb`/`.rpm` instalação ou protegida macOS A localização do aplicativo pode exigir autorização do sistema operacional. macOS as construções permanecem não assinadas e não anotadas.

Um resultado de instalação é mantido no perfil da área de trabalho privada. O erro é mostrado no próximo lançamento; não é escondido imediatamente pela verificação de inicialização. As construções mais antigas precisam de uma instalação de uma versão que inclua este updater, usando o pacote público ou `jaunt gui --install-only`.

## Progresso visível

Transferências de imagens da Web e da área de trabalho mantêm o seu resultado real: o envio verificado e a inserção do caminho citado sem o Enter, ou a conclusão da área de transferência da máquina mais a entrega do Ctrl+V. Eles não afirmam que um CLI reconheceu um anexo. As verificações da máquina mostram a conclusão, falha ou diferimento explícito para o trabalho ativo. O Android usa diálogos de progresso nativos para verificações e downloads do APK, seguidos da confirmação do instalador do sistema operacional.
