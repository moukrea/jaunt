[English](../../../INSTALLER_FEDORA.md) · [fr](../../fr/docs/INSTALLER_FEDORA.md) · [es](../../es/docs/INSTALLER_FEDORA.md) · [it](../../it/docs/INSTALLER_FEDORA.md) · [pt](INSTALLER_FEDORA.md) · [de](../../de/docs/INSTALLER_FEDORA.md)

# Correções do instalador — 15 de setembro de 2026

O relatório inicial do usuário dizia respeito ao Fedora: o comando não produziu saída e o executável permaneceu no beta.2. Não houve acesso remoto a essa máquina. As correções iniciais do bootstrap não estabeleceram a causa na máquina do usuário. Um relatório posterior forneceu o `curl (23) Failed writing body` durante o download do `config.json`.

## Defeitos e correcções reproduzidos

- O comando `curl -fsSL … | bash` antigo retorna 0 quando o curl falha e o Bash recebe entrada vazia. O comando oficial agora usa o Bash com o `pipefail`, o progresso visível, um tempo- limite de conexão de dez segundos e um limite de 120 segundos para o download inicial do script.
- Uma configuração do ficheiro de saída `.curlrc` pode absorver o programa para que nada seja executado. Isto foi reproduzido usando o curl real e um servidor HTTP local. O `-q` líder ignora essa configuração no comando oficial; os downloads internos usam o `--disable`.
- O script anuncia imediatamente a inicialização e cada download. Erros inesperados identificam o código de fase, linha e saída sem imprimir segredos ou comandos completos.
- Os downloads internos do HTTPS são limitados a 120 segundos por tentativa. Erros de conexão/transferência selecionados desencadeiam uma repetição IPv4 visível; as falhas do HTTP e do certificado não são contornadas. As redirecionações permanecem restritas ao HTTPS.
- Um processo curl com um espaço de nomes separado do sistema de ficheiros não pode abrir o caminho de directório temporário criado pelo Bash. Um verdadeiro Fedora- container curl reproduziu a saída 23 no `Downloading config.json`, antes de qualquer mutação de instalação. Os downloads agora usam o redirecionamento de saída do shell: o Bash abre o destino e o curl escreve através do stdout herdado. Isto funciona mesmo quando o curl não consegue ver o caminho de destino. Ele não ignora a exaustão de armazenamento ou escreve a negação no sistema de ficheiros de destino.
- Ativo-shell guardas, verificação de rodas e preservação de identidade permanecem no lugar.

A documentação curl define [saída 23 como uma falha de escrita local](https://curl.se/libcurl/c/libcurl-errors.html). Esse código sozinho não identifica a causa exata na máquina do usuário; o isolamento do sistema de arquivos é o caso reproduzido aqui.

## Observações

- `pytest -q tests/test_installer_bootstrap.py`: quatro falhas contra os arquivos de inicialização anteriores, em seguida, quatro passa após a primeira correção. Estes cobrem falha de rede, falha de HTTP, status de saída de pipeline e redirecionamento de saída `.curlrc`.
- `pytest -q`: 49 testes passaram localmente com Python 3.14.2 após a primeira correção.
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py`: passado.
- `python tests/installer_e2e.py`: oito verificações passaram, incluindo checksums adulterados, recusando-se a matar um shell ativo real, e reinicialização explicitamente autorizada.
- Fedora 44, novo recipiente oficial, script público anterior através de instalação `curl … | bash`: beta.5 bem sucedido. Fedora sozinho não reproduziu o problema do usuário.
- Fedora 44, recipiente oficial fresco, script corrigido piped em Bash: instalou a verdadeira roda pública beta.5, com Python privado 3.12.14 instalado por uv; saída 0 e versão 0.1.0b5.
- Fedora 43, novo recipiente oficial: instalador anterior e roda beta.2 pública, seguido pelo instalador corrigido e roda beta.5 pública. Versões verificadas antes/depois; identidade e mesa do dispositivo preservada.
- O primeiro comando corrigido foi obtido da página publicada e executado em um novo container Fedora 43 após [Páginas de implantação](https://github.com/moukrea/jaunt/actions/runs/34931947575). Os bytes do instalador público corresponderam à fonte revisada e a versão 01.0b5 foi verificada.
- `python tests/installer_namespace_e2e.py`: instalação real de roda pública com curl em um recipiente Fedora 44 e Bash/Python fora dele. Nenhum diretório host é montado no recipiente do curl. Antes da correção de redirecionamento de saída, o download da configuração falhou com a saída 23. Após a correção, a roda instalada a partir do lançamento público, importada do tempo de execução privado, e começou o daemon com atualizações automáticas habilitadas.
- O IC necessário inclui instalações reais Fedora 43/44. O trabalho Fedora 44 também executa a regressão de instalação de curl do sistema de arquivos separados.

Os testes Fedora usam recipientes isolados sem um gerenciador de serviços de usuário (`jaunt_NO_SERVICE=1`) e suprimem a saída QR (`jaunt_SKIP_PAIR=1`). Eles validam a instalação e a inicialização de fundo, não systemd/SELinux em uma estação de trabalho física Fedora. O serviço de usuário foi validado anteriormente em Ubuntu; nenhuma nova validação física Fedora é reivindicada.

Estas correções se aplicam ao ponto de entrada e fonte do instalador de Páginas. Os ativos beta.5 publicados e o APK beta.3 permanecem imutáveis. A máquina não precisa de um novo número de versão para usar o instalador de Páginas atualizado. O instalador incorporado na roda beta.5 mantém o seu código anterior até que um futuro lançamento da máquina.

O protocolo permanece sem uma auditoria de segurança independente.

## Acompanhamento: saída 23 persistente após o redirecionamento do shell

O usuário posteriormente relatou a mesma falha de gravação na linha 65. A regressão do espaço de nomes havia passado, mas não havia resolvido a falha do usuário remoto. Nenhuma alegação foi feita de que o sistema de arquivos remoto ou a configuração do curl foi diagnosticada.

Um teste Fedora 44 separado com Python 3.14.7 e um 4 completamente completo KiB `/tmp` tmpfs reproduziu o erro exato do `curl: Failed writing body` e a falha da linha-65. Um diretório e um arquivo vazio ainda poderiam ser criados lá, mas a gravação da resposta falhou. Este teste usa apenas um recipiente Docker descartável; ele não preenche nenhum sistema de arquivos host ou pessoal.

O instalador agora está ao lado do tempo de execução no sistema de arquivos de destino, verifica se ele pode gravar 1 MiB lá, e fornece essa pasta temporária privada para pip/ uv durante a instalação. Ele não altera o TMPDIR das sessões do servidor host ou do shell. O diretório de encenação é removido ao sair. Um sistema de arquivos de destino completo ainda produz um erro de armazenamento claro; o instalador não exclui os arquivos de usuário para criar espaço.

Quando o cacho retorna 23 e o Python está disponível, um downloader padrão da biblioteca HTTPS retorna o arquivo de forma independente. Ele usa a validação normal do certificado, rejeita o redirecionamento não- HTTPS, limita a transferência inteira para 120 segundos e 128 MiB, detecta corpos incompletos e rushes/fsyncs o resultado. A verificação do checksum da roda ainda acontece antes da substituição em tempo de execução. Este retorno não lida com falhas arbitrárias do TLS/HTTP, enfraquecendo a validação.

Comandos de validação para este seguimento:

- `pytest -q`: 53 testes passaram localmente. Quatro novas verificações exercem o Python fallback HTTPS e redirecionam os limites.
- `python tests/installer_storage_e2e.py`: instalações reais Fedora com um `/tmp` completo, e com cada download curl interno forçado a escrever para `/dev/full`. O segundo cenário exerce saída curl real 23 seguido de downloads reais públicos HTTPS através do Python. Ambos os cenários verificam o daemon em execução, limpeza de encenação e ausência de um caminho de estadiamento excluído no ambiente daemon.
- `python tests/installer_e2e.py`: todas as oito verificações existentes passaram, incluindo preservação ativa-shell, rejeição de checksum e autorização de reinício explícita.
- `python scripts/build_release.py`, `npm run prepare-web`, e `python scripts/check_project.py`: passou.

O trabalho Fedora CI necessário executa ambos os novos cenários de instalação, além do teste de espaço de nomes anterior. Estas são observações de ambiente de teste, não uma alegação de execução bem sucedida na máquina inacessível do usuário Fedora.
