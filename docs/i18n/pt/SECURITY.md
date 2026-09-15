[English](../../../SECURITY.md) · [fr](../fr/SECURITY.md) · [es](../es/SECURITY.md) · [it](../it/SECURITY.md) · [pt](SECURITY.md) · [de](../de/SECURITY.md)

# Modelo de segurança — beta não auditado

O jaunt fornece um shell completo sob a conta da máquina. Não existe nenhum sistema de arquivos sandbox ou função somente de leitura: um dispositivo autorizado pode agir como esse usuário. Não execute a máquina com privilégios que os dispositivos remotos não precisam.

## O que está protegido

Os comandos, saída, arquivos e dados da área de transferência são criptografados entre o navegador e a máquina. O relé vê endereços de rede, salas, presença, tamanhos de pacotes e tempo, e chaves públicas efêmeras. Ele não contém o emparelhamento ou os segredos do dispositivo. O canal é autenticado por um segredo aleatório de 256 bits, com ECDH e AES- GCM efêmeras. Veja [a especificação de protocolo](docs/PROTOCOL.md).

Os primitivos vêm da criptografia e da Web Crypto. **A sua composição para este protocolo é nova e não recebeu uma auditoria externa.** Os testes de interoperabilidade não substituem uma auditoria.Não descreva jaunt como certificado, invulnerável ou pronto por padrão para ambientes de produção sensíveis.

## O que não está protegido

- Um navegador, máquina ou conta do sistema comprometido permanece comprometido.
- GitHub Pages serve código que pode acessar segredos após desbloquear: um atacante que controla o repositório ou página pode substituir o JavaScript. Encriptação de ponta a ponta não protege contra uma atualização maliciosa do cliente.
- Sem uma senha, as chaves são armazenadas sem criptografia no IndexedDB, como uma sessão lembrada. Uma senha/PIN as criptografa em repouso; um PIN curto permanece vulnerável a adivinhações off-line. Prefere uma frase- senha longa.
- O bloqueio para as ligações e limpa as vistas activas. Não garante a eliminação criptográfica da RAM do navegador.
- Um código QR completo concede acesso shell por dez minutos. Nunca coloque em um problema, captura de tela pública, registro de CI ou análise.
- As notificações de navegador são entregues através do serviço de push do navegador. Os títulos e os corpos de notificação fornecidos pelo programa são exibidos e enviados através desse serviço; não incluem segredos nas notificações. O Android segue as configurações de privacidade da tela de bloqueio do sistema. A saída do terminal não é raspada para notificações.
- Um dispositivo revogado não pode mais autenticar o canal, mas conhece a capacidade de roteamento compartilhada anterior. Ele ainda pode interromper a disponibilidade do relé até que a identidade da máquina seja rotacionada. Os segredos de roteamento não são um sistema de quotas completas ou anti- DDoS.

## Origem das páginas compartilhadas do GitHub

Os sites do `moukrea.github.io/another-project/` e do `moukrea.github.io/jaunt/` compartilham uma origem do navegador. Outro projeto vulnerável nessa origem poderia atingir o armazenamento do jaunt. Os caminhos não são um limite de segurança. Para uso sensível, sirva o jaunt em uma origem dedicada (seu próprio domínio/subdomínio) e pare novamente lá. Um PIN protege as chaves em repouso, mas não substitui o isolamento de origem ou a confiança no JavaScript que está sendo servido.

## Armazenamento e permissões

O `~/.local/share/jaunt/host.json` e o 'socket' de controlo são privados para a conta actual. O directório usa o modo 0700, o estado usa 0600 e escreve são atómicos. O `attachments/` contém ficheiros carregados; o bloqueio da aplicação não os apaga. Remove anexos desnecessários através do navegador de ficheiros.

Chaves persistentes nunca aparecem em URLs de pedidos: o emparelhamento usa o fragmento, que é imediatamente removido do histórico. As capacidades de transmissão são enviadas no primeiro frame do WebSocket sobre o TLS. O Trabalhador não registra as cargas úteis.

## Implantação

Use o loopback externo do HTTPS/WSS, restrinja o APP_ ORIGIN à origem exata das Páginas, habilite as proteções MFA e de ramificações, minimize as permissões Cloudflare/GitHub e monitore as cotas e custos. Não adicione scripts ou extensões de análise de terceiros à página. Os scripts estáticos de CSP em linha e a avaliação dinâmica; as dependências são locais. As Páginas GitHub não podem definir cada cabeçalho de segurança do servidor; use um domínio/proxy controlado para endurecimento adicional.

## Relatar uma vulnerabilidade

Use o canal de relatórios de vulnerabilidade privada do repositório quando disponível. Nunca publique uma chave, código QR, log confidencial do terminal, arquivo host.json ou exportação de cofre. Antes da divulgação pública, o mantenedor deve estabelecer um canal de comunicação privado e política de rotação.

## Limite da área de trabalho

O renderizador de área de trabalho é sandboxed, com a integração Node desactivada e o isolamento de contexto activado. Ele recebe uma interface IPC estreita pré- carregada, validada contra o quadro principal da aplicação. Os recursos agrupados são servidos através do esquema seguro `jaunt://app/`; a navegação externa abre o navegador do sistema e nunca recebe a ponte da máquina. O relé também admite a origem exacta do renderizador nativo `jaunt://app` para conexões remotas de área de trabalho; as origens arbitrárias do navegador permanecem rejeitadas. As verificações de origem não são autenticação: os clientes nativos ainda precisam de recursos de roteamento e o aperto de mão criptografado do servidor. O acesso local usa o socket de controle privado do Unix existente e concede os mesmos privilégios de conta que o CLI. Não é um segundo ouvinte de rede e não ignora a autenticação remota.

A versão da área de trabalho e o instalador da máquina fazem parte da superfície de atualização confiável. Os checksums detectam artefatos corrompidos/mismáveis; eles não protegem contra um editor de repositório/lançamento comprometido. Os pacotes da área de trabalho contêm apenas arquivos de aplicativos listados e dependências de tempo de execução, não os perfis de host ou de usuário. Os sobreposições somente para renderizadores de teste nunca devem entrar em lançadores de produção.
