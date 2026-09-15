[English](../../../PROTOCOL.md) · [fr](../../fr/docs/PROTOCOL.md) · [es](../../es/docs/PROTOCOL.md) · [it](../../it/docs/PROTOCOL.md) · [pt](PROTOCOL.md) · [de](../../de/docs/PROTOCOL.md)

# Protocolo jaunt v1

Este documento descreve a implementação, não uma garantia de segurança ou uma norma.

## Transportes e identidades

Endpoint: `wss://RELAY/v1/room/ROOM`. O QUARTO tem 18 bytes aleatórios, codificados como base 64url (24 caracteres). As capacidades de roteamento são 32 bytes (43 caracteres). A máquina regista- se com o `hostToken` e o `clientToken`. O Objeto Durável armazena os seus hashes SHA-256 numa transacção atómica inicial; outra máquina não os pode substituir. O navegador contém apenas o clienteToken. As mensagens do cliente são roteadas usando um ID por pares atribuído pelo relé, não escolhido pelo cliente.

O relé armazena os hashes de roteamento e o estado de anexo necessários para hibernação, nunca o histórico do terminal. As chaves de criptografia permanecem nos endpoints. Ambas as conexões são de saída; a máquina não precisa de nenhuma porta de entrada. O navegador WebSockets deve usar o `APP_ORIGIN` configurado; a área de trabalho empacotada usa a origem `jaunt://app` permitida separadamente. As conexões nativas de host/Android sem origem permanecem suportadas. Todos os clientes ainda autenticam as capacidades de roteamento e o canal de ponta a ponta.

## Emparelhamento

`jaunt1.` seguido de base64url JSON contendo `v` (versão), `r` (relay), `h` (quarto), `t` (clientToken), `p` (pair ID), `s` (parer secret), e `n` (nome da máquina). A máquina armazena e executa a expiração; o navegador não trata o seu próprio valor de validade como autoritário. Um código QR aponta para a página com este código no fragmento. Tempo de vida: 600 segundos, uso único.

O navegador cria o seu ID do dispositivo e o segredo de 32-bytes e salva- os ANTES de consumir o código QR, então transmite- os apenas após autenticação e criptografia. Se a mensagem final de boas-vindas for perdida, ele primeiro tenta a identidade do dispositivo persistente, então emparelhando se ainda for válido. A revogação remove a autorização do lado do host e fecha os canais do dispositivo.

## Aperto de mão

Cada cliente e servidor cria uma chave P-256 efêmera. Chaves públicas usam codificação SEC1 sem compressão e base64url. A transcrição é um array compacto ASCII JSON nesta ordem exata:

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

As provas são HMAC-SHA256 (segredo, transcrição `server:`) e HMAC-SHA256 (segredo, transcrição `client:`), verificados antes de abrir o canal. `auth` distingue pareamento de um dispositivo lembrado. Cada conexão usa nonces aleatórios.

Compartilhado = P-256 ECDH. AAD = SHA256(transcript). HKDF-SHA256, comprimento 32, sal SHA256(secret), informação AAD / `jaunt-c2h` ou AAD / `jaunt-h2c`. Duas teclas AES / 256- GCM independentes, uma por direção. Os contadores rígidos começam em 1; o nó de 12 bytes é quatro bytes zero seguidos pelo contador uint64 big- endian. Feche e reconecte- se antes que o contador de nonce chegue a 2^53. Qualquer lacuna, duplicado ou falha GCM fecha o canal. As teclas efémeras nunca são reutilizadas após a reconexão.

Quadro de aplicação: `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. As mensagens descriptografadas são JSON; os blocos binários usam base64url. Orçamento de transporte: 132.000 caracteres. Entrada, saída e os arquivos são blocos antes da criptografia.

## RCP e fluxos

Solicitações: `{type:"rpc", id, method, params}`. Respostas: `{type:"reply", id, ok:true, result}`, ou o formulário de erro definido em daemon.py. `Peer.dispatch` e `Host.rpc` são a fonte de verdade para métodos e eventos; não invente um segundo esquema, divergente.

As sessões usam IDs idempotentes e saída com deslocamentos absolutos de bytes. Após a reconexão, o `session.attach(after)` reproduz apenas o resultado retido que não foi recebido. Se o buffer foi truncado, é enviado um evento de redefinição explícito. As dimensões são compartilhadas: o último cliente ativo redimensiona o PTY comum.

Os envios usam IDs por transferência, propriedade do dispositivo, um deslocamento esperado e uma resposta offset para blocos duplicados. O SHA-256 é calculado durante o recebimento; o commit é atômico e não substitui um destino criado concomitantemente. Os arquivos temporários estão na mesma pasta com o modo 0600. As transferências expiram após uma hora de inatividade. Não há nenhuma retomada no disco após uma reinicialização da máquina. As transferências lêem arquivos regulares, verificam o tamanho e o mtime e usam 48 blocos KiB.

## Evolução

Um cliente Android nativo deve implementar este protocolo e a mesma semântica de armazenamento de identidade; ele não deve copiar a sessão WebSocket do navegador. Versão todas as alterações incompatíveis. Python/Web Crypto interoperabilidade e testes de repetição devem permanecer necessários em CI.

## Vistas compartilhadas e transporte local de desktop

Uma recepção opcional inclui o `peer`, o identificador de visualização atual. A informação da sessão inclui o `viewers` e o `activeView`. O `terminal.geometry` carrega as colunas do PTY, as linhas, a visão de controle e a lista de visualizadores. Uma entrada ativa explícita ou a geometria de redimensionamento das reivindicações; simplesmente a anexação não. A saída mantida registra suas dimensões e a repetição emite alterações de geometria em ordem. Os clientes serializam- nas com a fila de gravação assíncrona do terminal.

`session.detach` remove uma visão sem fechar o PTY. `session.terminate` termina explicitamente a sessão subjacente, incluindo uma sessão chamada tmux quando aplicável. O comportamento legado `session.close` permanece compatível com clientes mais antigos.

A ponte desktop envia as mesmas mensagens RPC/stream através do soquete de controle do UNIX 0600 após o `ui.connect`. A pasta pai do socket 0700 limita o acesso à conta da máquina. Nenhum segredo de emparelhamento é gerado para este canal da mesma conta; as conexões remotas retêm o aperto de mão criptográfico existente. A entrada nunca é reproduzida quando ambos os canais se reconectam.

O novo texto de emparelhamento usa o prefixo `jaunt1.` minúscula. Os clientes atualizados também aceitam o prefixo maiúscula original; os fragmentos de emparelhamento de URL e as etiquetas de transcrição criptográfica estão inalteradas. As sobreposições de variáveis de ambiente existentes são aceitas como aliases de compatibilidade, enquanto a nova documentação usa prefixos de produto minúsculas.

O `sessionDirectory: true` aceita `session.directory(id)` e o `sourceSession` opcional no `session.create`. Um `cwd` explícito não- vazio tem precedência. A máquina lê o diretório atual do processo shell no Linux/macOS e volta para o seu diretório inicial se o processo tiver saído ou o SO não puder fornecê- lo. Isto não introduz nenhum novo limite de transporte ou autorização.

Novas requisições de atualização da máquina retornam um ID de operação, realizada através de registros de status de atualização. Os clientes podem distinguir o resultado da verificação solicitada de uma verificação concluída anterior. Os estados incluem a verificação, transferência, verificação, instalação, instalação, atual, diferida e erro. Um erro do instalador não é relatado como esperando a menos que shells/transfers ativa realmente bloqueou um reinício não autorizado.
