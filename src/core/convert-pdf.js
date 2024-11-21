import pdfjsLib from 'pdfjs-dist';

async function convertPdfBufferToText(pdfBuffers) {
  const texts = [];

  for (const pdfFile of pdfBuffers) {
    const { filename, buffer } = pdfFile;
    console.log(`Processando arquivo: ${filename}`);

    try {
      // Carregar o documento PDF a partir do buffer
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdfDocument = await loadingTask.promise;

      let text = '';

      // Iterar por todas as páginas do PDF
      for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const textContent = await page.getTextContent();

        // Concatenar o texto extraído
        text += textContent.items.map((item) => item.str).join(' ') + '\n';
      }

      texts.push({ filename, text });
      console.log(`Texto extraído do arquivo: ${filename}`);
    } catch (error) {
      console.error(`Erro ao processar o arquivo ${filename}:`, error.message);
    }
  }

  return texts;
}

export default convertPdfBufferToText