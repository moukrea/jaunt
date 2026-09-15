[English](../../../ANDROID.md) · [fr](../../fr/docs/ANDROID.md) · [es](../../es/docs/ANDROID.md) · [it](../../it/docs/ANDROID.md) · [pt](ANDROID.md) · [de](../../de/docs/ANDROID.md)

# jaunt Android

O cliente Android empacota a interface funcional existente em um APK. O código Java nativo implementa o acesso à área de transferência, a câmera QR, a seleção/salvamento de arquivos e uma conexão de notificação de primeiro plano opt-in. O UI permanece HTML/JS no Android System WebView. Nenhum runtime JavaScript vem de um CDN ou da Página pública: os ativos são empacotados no APK.

## Utilização

Instale o APK assinado a partir da versão Android, então abra o jaunt e verifique o `jaunt pair` QR da máquina. O Android pode pedir que você permita a instalação do navegador usado para baixá-lo. Esta permissão é apenas para instalação; nenhuma nova conta na nuvem é necessária.

Abra um shell e use Colar após copiar uma captura de tela. Com uma área de transferência da máquina suportada, a imagem é enviada, copiada para essa área de transferência e o Ctrl+V é enviado para o PTY selecionado sem o Enter. Caso contrário, as opções de localização/attachment explícitas existentes permanecem. Anexar abre o seletor de arquivos/gallery do Android. As imagens compartilhadas de outra aplicação requerem uma confirmação nomeando o destino shell. As transferências abrem a janela Salvar do Android.

Activar as notificações de fundo do Android em Definições para cada máquina. O Android solicita a permissão de notificação; uma notificação persistente mostra a contagem de ligações e oferece o Stop. As notificações mostram o título e a mensagem do programa e abrem o seu host/session quando for gravado. O Android controla a visibilidade da tela de bloqueio. O jaunt não raspa a saída do terminal para fabricar o texto de notificação. O `jaunt notify "Need your attention"` e o `jaunt run -- command` podem accioná- los. O serviço de utilizador da máquina deve estar activo.

O Android pode restringir o acesso à rede nas políticas de bateria do fornecedor. O Force-stop impede a operação automática até que o aplicativo seja aberto novamente. A entrega da notificação não é garantida. Um serviço de primeiro plano não é um VPN e não requer credenciais Firebase/FCM.

## Limites de segurança

- `WebViewAssetLoader` serve apenas ativos empacotados no `https://moukrea.github.io/jaunt/`. Os ativos em falta falham fechados. Links externos abertos fora do WebView privilegiado.
- A ponte de mensagens nativa aceita apenas a origem exata do HTTPS e o quadro principal. Nenhum carregamento de URL de arquivo/conteúdo, tráfego de texto claro, liberação de depuração WebView ou backup está habilitado.
- As identidades de notificação Android usam a chave do dispositivo já emparelhada e jaunt v1 PSK-autenticada P-256/HKDF/AES-GCM canal. Os contadores autenticados rigorosos rejeitam replay. A interoperabilidade do protocolo nativo é testada contra a máquina Python instalada.
- Apenas a opção explícita de notificação de fundo copia os campos de identidade necessários para o armazenamento criptografado pelo Android Keystore. Esquecer/recusa remove- os. O bloqueio de válvulas esconde os dados do terminal, mas não desactiva uma ligação de fundo activada separadamente.
- Códigos de pareamento, conteúdo da área de transferência, chaves de assinatura, registros terminal e identidades locais não são ativos de liberação.
- O protocolo e esta nova implementação nativa não tiveram uma auditoria de segurança independente**.

## Compilar e lançar

Usar o JDK 17 Android Plataforma SDK 37.0, build-tools 36.0.0 e o invólucro Gradle verificado. O comportamento alvo é Android 16/API 36; API de instalação mínima é 26. Dependências de Gradle e verificação de artefatos são geradas a partir de resolução real e verificadas.

```sh
npm ci
npm run prepare-web
android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`android-v*` tags executar `.github/workflows/android.yml`. A tag deve corresponder `versionName`. A assinatura usa os segredos do repositório `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` e `ANDROID_KEY_ALIAS`; a chave é materializada apenas na pasta temporária do corredor e removida depois. A versão contém o APK assinado, SHA256SUMS e saída de verificação do certificado de assinatura. Uma versão existente nunca é sobrescrita. Host `v*` versões permanecem separadas com seus três ativos do instalador.

O teste Android APK contém um dispositivo de área de transferência isolado para o emulador. Ele não é enviado na versão APK e não adiciona nenhum endpoint de depuração de produção. A automação WebView de depuração está desativada nas compilações de lançamento.

## Validação

Veja `docs/evidence/android-report.json` para os resultados observados. A câmera física Android, as diferenças de teclado/IME, as restrições de bateria do fornecedor, o real comportamento de handoff do Wi-Fi/mobile e notificação de deep-idle ainda requerem validação de dispositivo físico. Teste de screen-off do emulador é relatado separadamente. Nenhuma alegação é feita de que uma compilação real Claude Code/Codex exibiu um anexo apenas porque bytes de área de transferência e entrega Ctrl+V passou.

## Atualizações de aplicativos

A versão APK verifica o canal de lançamento publicado automaticamente quando aberto (no máximo uma vez por seis horas); uma conexão de fundo habilitada também verifica e pode notificá-lo sobre uma atualização. Configurações → Verifique se as atualizações forçam uma verificação. jaunt baixa o APK apenas depois de escolher Baixar e instalar, verifica o SHA-256 contra o arquivo de checksum de liberação, verifica o ID do aplicativo e o certificado de assinatura contra o aplicativo instalado, e recusa a versão downgrades. O próprio instalador do Android então pede confirmação. Na primeira atualização, o Android pode exigir “Permitir a partir desta fonte” para o jaunt. Um aplicativo sideloaded normal não pode ignorar silenciosamente esta confirmação do sistema operacional.

Atualizações retêm os dados do aplicativo e chaves de emparelhamento. Desinstalar o aplicativo os remove. A atualização APK é compartilhada com o instalador do Android através de uma concessão privada do FileProvider, não um diretório de leitura pública.
