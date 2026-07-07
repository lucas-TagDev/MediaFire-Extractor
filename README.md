# MediaFire Link Extractor

Extensão para Chrome que escaneia a página aberta, coleta todos os links do MediaFire e permite baixar cada um ou todos de uma vez. O download é **direto**: a extensão abre cada página do MediaFire em segundo plano, extrai o link real do arquivo e dispara o download pelo Chrome.

## Instalar

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (Load unpacked).
4. Selecione a pasta `mediafire-extractor`.

## Usar

1. Abra a página que contém os links (ex.: a página de episódios do exemplo).
2. Clique no ícone da extensão. Ela escaneia automaticamente.
3. Cada link aparece com um botão **Baixar**, ou use **Baixar todos** no topo.

## Como funciona o download direto

O `background.js` faz `fetch` da página de cada arquivo no MediaFire e procura o link real usando, nesta ordem:

1. `data-scrambled-url` (base64 do link, layout atual do MediaFire);
2. o atributo `href` do `#downloadButton`;
3. qualquer URL `download*.mediafire.com` presente no HTML.

## Limitações

- Se o MediaFire exigir **captcha** ou mudar o layout, o link direto pode não ser encontrado — nesse caso o item fica marcado como erro.
- "Baixar todos" processa os arquivos em sequência para não sobrecarregar o servidor.
- Os arquivos vão para a pasta de downloads padrão do Chrome.

## Ícone (opcional)

A extensão funciona sem ícone próprio (o Chrome usa um padrão). Para adicionar um, coloque `icon16.png`, `icon48.png` e `icon128.png` numa pasta `icons/` e adicione de volta os campos `default_icon`/`icons` no `manifest.json`.
<img width="1361" height="927" alt="image" src="https://github.com/user-attachments/assets/de8cb9e2-b872-479e-ab29-a662085a521f" />
