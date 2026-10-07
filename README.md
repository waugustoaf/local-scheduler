# Local Scheduler

Aplicativo Electron para macOS que agenda SQL e scripts no próprio Mac ou via SSH. O agente continua funcionando com a janela fechada.

## Instalação

Requer macOS 13 ou superior, Node.js 22.16 ou superior e as ferramentas de linha de comando do Xcode para compilar o componente de despertar.

```sh
xcode-select --install
npm install
npm test
npm run typecheck
npm run build
npm start
```

Para gerar o aplicativo:

```sh
npm run package
```

Mova `release/Local Scheduler.app` para `/Applications` antes da primeira abertura. A primeira abertura registra o agente da sua sessão no launchd. Em Configurações, instale o serviço de despertar; o macOS solicitará autorização de administrador. O pacote pessoal usa assinatura local. Distribuição para outros usuários requer certificado e notarização.

## Primeiro agendamento

1. Em Conexões, salve o SSH com host, usuário, porta, chave e passphrase, se houver. Use caminhos completos; não use `~`.
2. Use Testar conexão para obter o fingerprint sem transmitir credenciais. Confira com uma fonte confiável, aceite salvar e teste novamente para verificar a autenticação.
3. Salve o PostgreSQL com o host real do banco, porta, usuário e senha. Selecione o SSH para criar o túnel automaticamente. O certificado TLS é validado contra o hostname real mesmo através do túnel. Para RDS, selecione o certificado CA correspondente quando necessário.
4. Teste o banco. Esse teste executa somente uma consulta de identificação e `SELECT 1`, nunca a query do agendamento.
5. Crie um agendamento SQL ou Scripts. Escolha uma data completa ou recorrência, o fuso horário, a tolerância ao atraso e o tempo limite. Salve como memória para reutilizar a configuração.

Para scripts locais ou remotos, configure o interpretador, argumentos como lista JSON, diretório de trabalho, variáveis como objeto JSON e stdin. Scripts salvos no agendamento preservam o conteúdo. Arquivos no destino são lidos na hora da execução e acompanham suas alterações.

## Disponibilidade

Por padrão, o serviço agenda um despertar cinco minutos antes. O agente impede o repouso durante a execução. Mantenha o Mac ligado à energia, com a sessão iniciada, rede disponível e tampa aberta. A tela pode estar bloqueada. O aplicativo não promete execução com o Mac desligado, sem rede ou aguardando login do FileVault.

Se o Mac acordar dentro da tolerância, o agente executará a ação. Fora dessa janela, o histórico indicará que ela não foi executada. A mesma ocorrência não é repetida automaticamente. Recorrências preservam a hora local no fuso selecionado. Horários inexistentes em mudanças de horário de verão são rejeitados ou pulados nas recorrências; horários ambíguos usam a primeira ocorrência.

Interrupções, cancelamentos e perda de conexão podem deixar efeitos no destino. O histórico indica resultado incerto quando falta confirmação. Verifique o destino antes de usar Executar agora. A opção de transação SQL deve ser usada sem comandos de controle de transação próprios na query.

## Dados e credenciais

Os dados ficam em `~/Library/Application Support/Local Scheduler/scheduler.sqlite`, com acesso restrito ao usuário. Senhas e passphrases são armazenadas criptografadas pelo Electron safeStorage com proteção do Keychain. O executor recebe somente os perfis necessários para a ação. Segredos conhecidos são removidos das saídas registradas. Evite colocar senhas dentro de queries, scripts e variáveis comuns; esses conteúdos são configurações persistidas.

O agente usa `~/Library/LaunchAgents/com.localscheduler.agent.plist`. O componente de despertar fica em `/Library/PrivilegedHelperTools/com.localscheduler.wake` e usa `/Library/LaunchDaemons/com.localscheduler.wake.plist`. Ele só agenda e cancela eventos pertencentes ao usuário deste aplicativo. Não executa queries ou scripts como administrador.

## Adicionar módulos

Implemente `TaskModule` em `src/core/types.ts`, com `validateConfig`, `preflight` e `execute`. Registre o módulo em `src/modules/index.ts`. Para sua interface, registre um editor em `src/ui/moduleEditors.tsx`. O motor de agendamento não depende dos módulos SQL ou Scripts e não precisa ser alterado para novos módulos.

Cada memória possui namespace do módulo e versão. Perfis de SSH e banco são compartilhados e referenciados por ID. O histórico guarda uma cópia da configuração executada, independente de edições posteriores no agendamento.

## Desenvolvimento e verificação

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

A prévia de navegador é exclusivamente visual e usa dados locais separados; nunca executa scripts, SQL ou altera o Mac.

A correção da ponte e dos avisos foi verificada com 19 testes, checagem completa de tipos, build e geração do pacote com assinatura local. A abertura do aplicativo, as permissões de notificações, o Keychain, o início real pelo launchd e o despertar físico precisam ser verificados no aplicativo instalado. Nenhuma credencial, agendamento ou configuração de produção foi importada.

## Remoção

Pause os agendamentos e aguarde o fim das execuções. Remova o agente:

```sh
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.localscheduler.agent.plist"
rm "$HOME/Library/LaunchAgents/com.localscheduler.agent.plist"
```

Para remover também o serviço de despertar:

```sh
sudo launchctl bootout system /Library/LaunchDaemons/com.localscheduler.wake.plist
sudo rm /Library/LaunchDaemons/com.localscheduler.wake.plist /Library/PrivilegedHelperTools/com.localscheduler.wake
```

Os dados locais permanecem para preservar o histórico. Remova a pasta de dados manualmente se não precisar mais deles. Um evento de despertar já registrado pode permanecer no macOS até seu horário; pause os agendamentos com o serviço ainda instalado antes da remoção para cancelar os eventos do aplicativo.

## Executor e avisos

Abra o aplicativo uma vez depois de movê lo para `/Applications`. O executor é registrado no launchd com `RunAtLoad` e `KeepAlive`: inicia após o login da sessão e é reiniciado se encerrar inesperadamente. Fechar o dashboard ou usar Sair encerra apenas a interface. Não precisa abrir o dashboard nos próximos logins. O macOS deve permitir sua atividade em segundo plano. Atualizações do código recarregam o agente na próxima abertura do dashboard, quando não houver ações em execução.

O estado do executor aparece no dashboard. Se perder a conexão, ele deixa de aparecer como ativo; use Verificar executor para tentar restabelecer o serviço. Falhas, resultados incertos, cancelamentos e ocorrências vencidas geram avisos persistentes na tela principal e notificações nativas, mesmo com o dashboard fechado. Os avisos permanecem até serem marcados como vistos. A indisponibilidade do serviço de despertar também aparece como aviso.

Em Configurações, use Testar notificação. Permita notificações para Local Scheduler em Ajustes do Sistema; o modo Foco pode ocultar banners. Clique em uma notificação para abrir o dashboard. O executor depende da sessão iniciada, inclusive depois de um reinício com FileVault.

A ponte Electron usa `window.localScheduler`, sem colidir com a API `window.scheduler` do Chromium.

## Certificado automático do Amazon RDS

Em Editar conexão, escolha Amazon RDS (automático) no campo Certificado do banco e salve. A primeira configuração baixa o bundle público diretamente de https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem. O aplicativo valida o formato e os certificados antes de salvar em sua pasta de dados, na subpasta certificates. Nenhuma credencial do banco é enviada nesse download.

As conexões reutilizam o cache e tentam atualizar depois de 30 dias. Se a atualização falhar, um cache ainda válido permanece disponível. Sem um cache válido, o erro pede para verificar a internet e salvar novamente. A conexão continua validando a cadeia TLS e o hostname real do banco. A opção padrão ou arquivo CA continua disponível para outros bancos.
