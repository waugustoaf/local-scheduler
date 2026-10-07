# Local Scheduler

Aplicação macOS Electron com interface React, agente independente do processo da janela, SQLite local e credenciais criptografadas com chave protegida pelo Keychain. PostgreSQL é o driver inicial. SQL e scripts locais/remotos usam o mesmo contrato de módulo.

O agendador resolve datas com fuso explícito, persiste cada ocorrência antes de executar e nunca repete automaticamente uma execução interrompida depois de seu início. O serviço de energia agenda o próximo despertar, cinco minutos antes, por uma interface nativa limitada a listar, substituir e cancelar os eventos do aplicativo. Requer instalação autorizada pelo usuário. Não executa SQL ou scripts como root.

Etapas: contratos e persistência; módulos e conexões; agente e energia; interface; empacotamento e validação. Pasta definitiva solicitada: `/Users/waugustoaf/Documents/freela/local_scheduler`. Esta sessão implementa em `/private/tmp/local_scheduler` por restrição de escrita. Bibliotecas existentes poderão ser usadas para validar offline; o pacote entregue declara dependências instaláveis normalmente.
