[English](../../../DEPLOY_AGENT_PROMPT.md) · [fr](../fr/DEPLOY_AGENT_PROMPT.md) · [es](../es/DEPLOY_AGENT_PROMPT.md) · [it](../it/DEPLOY_AGENT_PROMPT.md) · [pt](DEPLOY_AGENT_PROMPT.md) · [de](../de/DEPLOY_AGENT_PROMPT.md)

# Prompt de entrega – jaunt

Você autorizou o acesso do GitHub ao `moukrea/jaunt`. Integrar e implantar o projeto neste arquivo. Não leia a implementação antiga para inspiração: este projeto é uma reescrita. Preservar o estado anterior em um branch de backup e, em seguida, trabalhar através de um branch e PR. Não forçar ou excluir o histórico.

O requisito não negociável é o acesso real a shells arbitrário através de um UI móvel/desktop, não apenas agentes Claude/Codex. Instalação de host de um comando, sem VPN/Tailscale ou configuração do servidor para usuários finais. Emparelhe uma vez pelo código QR, chaves persistentes, alterações de rede sem emparelhar novamente, arquivos, imagens, área de transferência, várias sessões e notificações.

## Execução

1. Leia README.md, SECURITY.md, docs/VALIDATION.md e docs/DEploYMENT.md; inspeccione o código fornecido. Não reescreva componentes de trabalho apenas para simplificá-los. Não esconda limitações documentadas.
2. Instale dependências de compilação/teste e gere e cometa um pacote-lock.json real. Verifique versões atuais e alertas de segurança. `npm run prepare-web` deve produzir uma cópia jsQR local e sua licença. Nenhum JavaScript em tempo de execução a partir de um CDN. Verifique cada importação e recurso sob o caminho `/jaunt/` publicado.
3. Executar testes pytest, retransmitir testes Node, testes reais Miniflare, check_project, build_ release e testes E2E do navegador. Ler falhas e corrigir as suas causas; nunca apenas remover asserções ou funcionalidades. Reportar comandos, versões e resultados observados.
4. Implemente o Trabalhador usando a conta Cloudflare autorizada. Os segredos necessários são CLOUDFLARE_API_ TOKEN e CLOUDFLARE_ ACCOUNT_ID. Se a autorização Cloudflare não estiver disponível, solicite SOMENTE essa autorização em falta através do mecanismo seguro apropriado e explique que um token GitHub não o concede. Nunca invente uma URL ou peça emprestado o relé público de outro projeto.
5. Configure APP_ORIGIN, verifique a saúde E WebSockets real, então defina jaunt_RELAY_URL em GitHub. Publique a tag/lançamento do host e seus três ativos antes de Páginas. Defina jaunt_RELEASE_TAG e ative Páginas através de Ações. Acesse o fluxo de trabalho das Páginas e verifique sua URL real.
6. Execute uma instalação real a partir da versão pública em uma máquina limpa, fonte não editável. Verifique o código de verificação, serviço de usuário, inicialização e código QR. Verifique as atualizações que preservam a identidade e a recusa de matar silenciosamente o shells normal ativo. Destruindo-os deve continuar a exigir autorização de reinicialização explícita.
7. Execute o fluxo de aceitação de ponta a ponta: página pública → emparelhamento → shell → comando com saída comprovada → nova guia → voltar ao primeiro shell → imagem/texto upload → baixar com comparação de byte → relé/interrupção de rede → mesma sessão sem uma nova QR → revogação. Em um telefone físico autorizado, câmera de teste QR digitalização, teclado, galeria, rotação, Wi-Fi/comutação móvel, PWA, e empurrar com a tela bloqueada. Nunca pretende ter usado um telefone se nenhum estiver disponível.
8. Preservar a distinção entre upload- plus- path sem Enter e pasta nativa condicional. Não reivindicar um anexo Claude/Codex quando apenas um caminho foi inserido. Torne o backback sem cabeça explícito. Nunca prometa uma área de transferência do sistema operacional que não exista.
9. Nunca publique host.json, .dev-state, segredos, códigos QR, exportações de cofres, ou registros privados terminal. Inspecione conteúdo ZIP/lançamento e fluxos de trabalho antes da publicação. Não execute varreduras destrutivas nos diretórios pessoais do usuário para testes.
10. Forneça a URL publicada, o comando de instalação validado, tag/release, relatório de teste e as limitações não validadas restantes. Não entregue 40 tarefas manuais. A implantação do proprietário acontece uma vez; os usuários finais não devem precisar de contas Cloudflare/GitHub para se conectar.

## Bloqueadores de publicação

Um relé não configurado, pasta de imagem falsamente reivindicada, shell criado não funcional, testes de passagem artificial, importação de JS em falta, lançamento inventado/URL ou publicação de blocos de segredos de repositório. A segurança do protocolo não foi auditada: retenha essa divulgação mesmo quando todos os testes passarem.
