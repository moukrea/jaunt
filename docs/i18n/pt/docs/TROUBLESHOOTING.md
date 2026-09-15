[English](../../../TROUBLESHOOTING.md) · [fr](../../fr/docs/TROUBLESHOOTING.md) · [es](../../es/docs/TROUBLESHOOTING.md) · [it](../../it/docs/TROUBLESHOOTING.md) · [pt](TROUBLESHOOTING.md) · [de](../../de/docs/TROUBLESHOOTING.md)

# Resolução de Problemas

□ Sintomas □ Diagnóstico e acção
|---|---|
A página ainda contém `relay:null`. Complete a implantação do proprietário. Não substitua uma URL fictícia.
O `jaunt` não foi encontrado após a instalação do shell ou usar o `~/.local/bin/jaunt`. Adicione o `~/.local/bin` ao PATH se a sua configuração do shell o excluir.
O `curl (23)` durante o download da configuração não pôde gravar os dados recebidos. Os estágios do instalador no sistema de arquivos em tempo de execução em vez do `/tmp`, abre os arquivos de download em Bash e repete falhas de gravação em curl através do Python. A exaustão real ou a negação de gravação no sistema de arquivos de instalação ainda causa um erro de armazenamento. Veja [validation do instalador](INSTALLER_FEDORA.md).
□ Código QR consumado ou expirado □ Em um dispositivo lembrado, abra o cartão da máquina em vez de reutilizar o antigo código QR. Para um novo dispositivo, execute `jaunt pair`.
Off-line do host: Verifique `jaunt status`, conectividade WSS/443, sono/hibernação e `jaunt doctor`. Nenhum novo código QR é necessário.
O serviço do usuário não está disponível O `jaunt start` é executado em segundo plano. Configure um serviço real do usuário para inicialização após o reinício. No Linux, executar enquanto logado também depende da permanência do sistema, que pode exigir um administrador.
A atualização recusada Ordinária PTYs está ativa. Termine-os, ou use explicitamente `jaunt_ALLOW_RESTART=1` e aceite sua terminação. O tmux é recomendado para tarefas de longo prazo.
□ Câmera negada ou ausente □ Permitir o acesso da câmera no HTTPS, selecione um arquivo de imagem QR, ou cole o código completo. A entrada manual não depende da câmera.
A imagem não é reconhecida como um anexo de agente. O Upload- plus- path funciona sem uma área de trabalho gráfica. A pasta nativa requer uma área de transferência da máquina e uma ferramenta CLI que a lê. Veja README; não existe um driver universal sem cabeça.
Não há notificação de push. Verifique o registro em Configurações, permissão do navegador, um PWA instalado, se necessário, conectividade de saída para o serviço de push e `jaunt notify`. Notificações não são geradas automaticamente para cada aplicativo shell.
O arquivo grande rejeitado □ O limite da máquina é de 512 MiB; os downloads na memória são limitados a 128 MiB. Use a escrita direta de arquivo se oferecido pelo navegador. Este limite ajuda a evitar matar uma aba móvel. □
Não há recuperação backdoor. Reinicie o cofre local, emparelhe novamente, e revogue a identidade antiga no host.
- Religado, mas a tarefa desapareceu. O daemon/OS reiniciado; um PTY normal era um filho desse daemon. Use o tmux para sobreviver ao daemon reinicia.
O texto copiado truncado O histórico é limitado: 2 MiB no host, 10.000 linhas no cliente. Redirecionar o resultado longo para um arquivo e baixá-lo.
Resposta do Relay 429 O projeto tem seu próprio relé, mas isso não garante imunidade de quotas ou abuso. Verifique as métricas Cloudflare, contagens de conexão e limites de sala.

Os registos da máquina não devem conter segredos. Nunca anexe o `host.json`, um código QR, uma exportação do IndexedDB ou um ficheiro confidencial a um relatório público. Para desinstalar, execute o `jaunt service uninstall`, depois o `jaunt stop`, e depois remova os binários de execução. Remova a pasta de estado apenas após a cópia de segurança/ revogação intencional: contém identidades e anexos.
