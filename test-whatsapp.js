import axios from 'axios';

// Simular uma mensagem do WhatsApp para o webhook
async function simulateWhatsAppMessage(messageText) {
  try {
    // Dados da mensagem simulada
    const sseData = {
      EventType: 'messages',
      message: {
        messageType: 'Conversation',
        sender: '5541999887766@s.whatsapp.net',
        text: messageText,
        fromMe: false,
        messageid: 'test-message-id-' + Date.now()
      }
    };
    
    console.log('Enviando mensagem simulada:', sseData.message.text);
    
    // Enviar para o endpoint local
    const response = await axios.post('http://localhost:3002/test-webhook', sseData);
    
    console.log('Resposta:', response.data);
    return response.data;
  } catch (error) {
    console.error('Erro ao simular mensagem:', error.message);
    if (error.response) {
      console.error('Detalhes do erro:', error.response.data);
    }
    return null;
  }
}

// Função para esperar um tempo específico
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Executar a simulação com diferentes comandos
async function runTests() {
  try {
    // Testar comando de ajuda
    console.log('\n=== TESTANDO COMANDO DE AJUDA ===');
    await simulateWhatsAppMessage('ajuda');
    await sleep(2000);
    
    // Testar listar categorias (forma natural)
    console.log('\n=== TESTANDO LISTAR CATEGORIAS (NATURAL) ===');
    await simulateWhatsAppMessage('quais são minhas categorias?');
    await sleep(2000);
    
    // Testar criar categoria (forma direta)
    console.log('\n=== TESTANDO CRIAR CATEGORIA (DIRETA) ===');
    await simulateWhatsAppMessage('criar categoria Restaurantes');
    await sleep(2000);
    
    // Testar criar categoria (forma natural)
    console.log('\n=== TESTANDO CRIAR CATEGORIA (NATURAL) ===');
    await simulateWhatsAppMessage('quero adicionar uma categoria chamada Lazer');
    await sleep(2000);
    
    // Testar listar categorias novamente
    console.log('\n=== TESTANDO LISTAR CATEGORIAS NOVAMENTE ===');
    await simulateWhatsAppMessage('mostrar categorias');
    await sleep(2000);
    
    // Testar registrar despesa
    console.log('\n=== TESTANDO REGISTRAR DESPESA ===');
    await simulateWhatsAppMessage('Almoço no shopping 45,90');
    await sleep(3000);
    
    // Testar relatório
    console.log('\n=== TESTANDO RELATÓRIO ===');
    await simulateWhatsAppMessage('como estão meus gastos?');
    await sleep(2000);
    
    console.log('\n=== TESTES CONCLUÍDOS ===');
  } catch (error) {
    console.error('Erro durante os testes:', error);
  }
}

// Executar todos os testes
runTests();
