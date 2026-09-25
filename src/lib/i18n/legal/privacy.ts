import type { Locale } from "@/lib/i18n/locales";
import type { LegalDoc } from "./types";

// A real, drafted policy reflecting what Picacho actually does today — not
// boilerplate. It is still a draft: see the "not legal advice" note shown
// alongside it on the page, and have an attorney review before launch.
// The "last updated" date is prose, not a token — "August 12, 2026" sat unchanged
// inside the Spanish, Italian and Portuguese documents, which is the one
// English sentence left on an otherwise translated legal page.
// Moves when the TEXT changes, not when the file does. September 1, 2026 is
// the day the data-controller section (LSSI operator card, GDPR controller,
// complaint route) was added — a material change that sat under "August 12"
// for a week because nothing tied the date to the wording. The 2026-09-07
// commit only localized this date; it changed no terms and did not move it.
// September 18, 2026 is the day the automatic error reports were disclosed:
// AppErrorReporter has filed them on the account since before the policy was
// written, and no section mentioned them (found reviewing what was owed).
// September 19, 2026 is the day the facial-information section was added
// for face verification (lib/faces/) — BytePlus's Real Person Verification
// Usage Rules, section 3, list what it must say.
// September 25, 2026 is the day voice was disclosed: the Android app gained
// the microphone (versionCode 20) for the Producer's hands-free voice, and
// recordings go to OpenAI for transcription — never stored by us. Same day,
// later: the Producer's spoken replies moved to ElevenLabs on fal (OpenAI
// only as the fallback), so the sentence naming who makes the speech changed.
const UPDATED: Record<Locale, string> = {
  en: "September 25, 2026",
  es: "25 de septiembre de 2026",
  it: "25 settembre 2026",
  pt: "25 de setembro de 2026",
};

const privacy: Record<Locale, LegalDoc> = {
  en: {
    title: "Privacy Policy",
    updated: UPDATED.en,
    intro:
      "This Privacy Policy explains what information Picacho (\"we\", \"us\") collects when you use the Picacho website and app, how we use it, and the choices you have.",
    sections: [
      {
        heading: "Who is responsible for your data",
        paragraphs: [
          "The data controller for Picacho is JEAR TECNICA S.A. (NIF A28847549), Paseo de la Castellana 259, 28046 Madrid, Spain. You can reach us using the contact details shown at the top of this page.",
          "If you believe your data has been handled improperly, you can also lodge a complaint with the Spanish data protection authority (AEPD, aepd.es) or your local supervisory authority in the EU.",
        ],
      },
      {
        heading: "Information we collect",
        paragraphs: [
          "Account information: your email address and password (handled by our authentication provider), and optionally a username, company, and self-reported gender.",
          "Character and content data: the character profiles you create (traits, reference images), the prompts you write, the images and videos generated for you, your notes, and your project organization.",
          "Usage data: pages you visit and when, plus (once the app is deployed to production) an approximate country derived from your IP address, used to understand product usage.",
          "Error reports: if the app hits a fault while you are signed in, we record an automatic report on your account — what went wrong, the page you were on, your browser and device, the browser's own identifier (user agent), and the technical trace, trimmed to 1,000 characters. Administrators read these to fix the fault, and they are deleted with your account. Nothing is recorded for signed-out visitors.",
          "Cookies: small identifiers used to remember your theme and language, and — for logged-out visitors — an anonymous visitor ID for basic traffic analytics.",
          "Payment information: payment details are collected and processed directly by our payment processor, Stripe. We never see or store your full card number — we keep only a reference to your Stripe customer and subscription so we can manage your plan.",
        ],
      },
      {
        heading: "How we use your information",
        paragraphs: [
          "To provide and operate the service — running the generation pipeline, storing your content, and keeping you signed in.",
          "To maintain and improve reliability, including aggregate usage statistics about which features are used.",
          "To communicate with you about your account.",
          "To detect abuse and enforce our Terms of Service.",
        ],
      },
      {
        heading: "AI-generated content",
        paragraphs: [
          "Prompts you submit are sent to third-party AI providers to draft, review, and generate your content. These providers process your prompt text — and, for image generation, a reference photo if you've added one — to produce a result. We don't control how these providers otherwise handle data beyond the terms of our agreements with them.",
          "Generated images and videos are stored in our cloud storage and are only accessible to your account, and to Picacho administrators for support and safety purposes.",
        ],
      },
      {
        heading: "Voice and the assistant",
        paragraphs: [
          "If you use a microphone feature (the mic in the composer, or talking to the Producer), your recording is sent to our AI provider, OpenAI, to be turned into text. Picacho does not store the recording; only the resulting text is kept, as part of your prompt or conversation. When the Producer answers out loud, its reply is sent to our voice provider, ElevenLabs (through fal), to be turned into speech; if that is unavailable, OpenAI does it instead. The microphone is used only after you tap a mic button and allow access.",
          "The Producer, the personal assistant on Elite accounts, keeps your conversation with it and the short notes it writes about how you work, so it can pick up where you left off. You can read, edit and delete every note, and clear the conversation, from the Producer itself. Both are deleted with your account.",
        ],
      },
      {
        id: "facial-information",
        heading: "Facial information (face verification)",
        paragraphs: [
          "Some video models refuse photos of real people. If a character is you, you can choose to verify your face so those models can use your photos. It is optional, it is only offered for your own face, and saying no does not affect anything else in Picacho.",
          "What happens: our provider BytePlus (BytePlus Pte. Ltd., Singapore), which runs the Seedance video models, records a short live face check on its own page to confirm that a real person is present (not a photo, a replay or a mask). After a successful check, BytePlus keeps one reference image of your face. Up to three photos of the character you choose are then sent to BytePlus and compared with that reference image to confirm they show the same person; photos that do not match are not used. The facial information involved is the images and video from the check and the facial features extracted from them.",
          "Why: only so the video models accept your own photos in videos you create from your own account. Your verified face is never used for anyone else's videos, for profiling or for advertising, and is not shared beyond BytePlus, which processes it only on our instructions.",
          "Consent and records: we ask for your explicit consent before the check starts, and we keep a record of when you consented and to which version of this notice.",
          "Where and for how long: BytePlus stores your facial information in its Southeast Asia region, outside the European Economic Area. It is kept until you remove your verification on the character page or delete your account. Removing your verification, or deleting your account, deletes it at BytePlus; if BytePlus cannot be reached at that moment, we retry every day until it is done.",
          "Your rights: you can withdraw your consent at any time on the character page, which stops the processing at once. To access, correct or delete your facial information, or for any other request about it, contact us at the support email shown in Settings — requests come to us, not to BytePlus.",
        ],
      },
      {
        heading: "Cookies & analytics",
        paragraphs: [
          "We use cookies for essential functionality — staying signed in, remembering your theme and language — and for basic, privacy-conscious analytics, such as page views and approximate country, so we can understand how the product is used. We do not sell this data.",
        ],
      },
      {
        heading: "Sharing your information",
        paragraphs: [
          "We share data with the service providers who help us run Picacho: our database, authentication, and file storage provider; our hosting provider; our AI generation providers; and, once enabled, our payment processor. We do not sell your personal information to third parties.",
        ],
      },
      {
        heading: "Data retention",
        paragraphs: [
          "We keep your account and content for as long as your account is active. If you delete your account from Settings, your profile, characters, generations, notes, and projects are permanently deleted. Anonymized traffic records that can't be linked back to you may be retained for analytics.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You can view and edit your account details, change your password, and permanently delete your account at any time from Settings. Picacho is operated from Spain, so the EU General Data Protection Regulation (GDPR) applies to how we process your personal data: you have the rights of access, rectification, erasure, restriction, portability, and objection. To exercise any of them, contact us at the support email shown in Settings and we'll respond within the timeframes the GDPR requires. You also have the right to lodge a complaint with the Spanish data protection authority (AEPD) or the supervisory authority where you live.",
        ],
      },
      {
        heading: "Children's privacy",
        paragraphs: [
          "Picacho is not directed at, and may not be used by, anyone under 18. We do not knowingly collect information from minors.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "We use industry-standard practices — encrypted connections, access controls, and row-level security on our database — to protect your information. No method of storage or transmission is 100% secure.",
        ],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "We may update this policy as the product evolves. We'll update the date above whenever we do.",
        ],
      },
      {
        heading: "Contact us",
        paragraphs: ["Questions about this policy? Reach us at the support email listed in Settings."],
      },
    ],
  },
  es: {
    title: "Política de privacidad",
    updated: UPDATED.es,
    intro:
      "Esta Política de privacidad explica qué información recopila Picacho (\"nosotros\") cuando usas el sitio web y la aplicación de Picacho, cómo la usamos y qué opciones tienes.",
    sections: [
      {
        heading: "Responsable del tratamiento",
        paragraphs: [
          "El responsable del tratamiento de los datos de Picacho es JEAR TECNICA S.A. (NIF A28847549), Paseo de la Castellana 259, 28046 Madrid, España. Puedes contactarnos mediante los datos de contacto que aparecen al inicio de esta página.",
          "Si consideras que tus datos se han tratado indebidamente, también puedes presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD, aepd.es) o ante tu autoridad de control local en la UE.",
        ],
      },
      {
        heading: "Información que recopilamos",
        paragraphs: [
          "Información de la cuenta: tu correo electrónico y contraseña (gestionados por nuestro proveedor de autenticación) y, opcionalmente, un nombre de usuario, empresa y género autoinformado.",
          "Datos de personajes y contenido: los perfiles de personaje que creas (rasgos, imágenes de referencia), las instrucciones que escribes, las imágenes y videos generados para ti, tus notas y la organización de tus proyectos.",
          "Datos de uso: las páginas que visitas y cuándo, además (una vez que la app esté desplegada en producción) de un país aproximado derivado de tu dirección IP, usado para entender el uso del producto.",
          "Informes de errores: si la app falla mientras tienes la sesión iniciada, guardamos un informe automático en tu cuenta — qué falló, la página en la que estabas, tu navegador y dispositivo, el identificador del propio navegador (user agent) y la traza técnica, recortada a 1.000 caracteres. Los administradores los leen para arreglar el fallo y se borran con tu cuenta. No se registra nada de los visitantes sin sesión.",
          "Cookies: identificadores pequeños que recuerdan tu tema e idioma y, para visitantes sin sesión iniciada, un ID de visitante anónimo para analítica básica de tráfico.",
          "Información de pago: los datos de pago los recopila y procesa directamente nuestro procesador de pagos, Stripe. Nunca vemos ni almacenamos tu número de tarjeta completo; solo guardamos una referencia a tu cliente y suscripción de Stripe para gestionar tu plan.",
        ],
      },
      {
        heading: "Cómo usamos tu información",
        paragraphs: [
          "Para prestar y operar el servicio: ejecutar el pipeline de generación, almacenar tu contenido y mantener tu sesión iniciada.",
          "Para mantener y mejorar la fiabilidad, incluyendo estadísticas agregadas de uso sobre qué funciones se utilizan.",
          "Para comunicarnos contigo sobre tu cuenta.",
          "Para detectar abusos y hacer cumplir nuestros Términos de servicio.",
        ],
      },
      {
        heading: "Contenido generado por IA",
        paragraphs: [
          "Las instrucciones que envías se transmiten a proveedores externos de IA para redactar, revisar y generar tu contenido. Estos proveedores procesan el texto de tu instrucción —y, para generación de imágenes, una foto de referencia si la has añadido— para producir un resultado. No controlamos cómo estos proveedores manejan los datos más allá de los términos de nuestros acuerdos con ellos.",
          "Las imágenes y videos generados se almacenan en nuestro almacenamiento en la nube y solo son accesibles para tu cuenta y para los administradores de Picacho, con fines de soporte y seguridad.",
        ],
      },
      {
        heading: "La voz y el asistente",
        paragraphs: [
          "Si usas una función de micrófono (el micrófono del compositor, o hablar con el Producer), tu grabación se envía a nuestro proveedor de IA, OpenAI, para convertirla en texto. Picacho no guarda la grabación; solo se conserva el texto resultante, como parte de tu prompt o de tu conversación. Cuando el Producer responde en voz alta, su respuesta se envía a nuestro proveedor de voz, ElevenLabs (a través de fal), para convertirla en voz; si no está disponible, lo hace OpenAI. El micrófono solo se usa después de que toques un botón de micrófono y permitas el acceso.",
          "El Producer, el asistente personal de las cuentas Elite, guarda tu conversación con él y las notas breves que escribe sobre tu forma de trabajar, para poder continuar donde lo dejaste. Puedes leer, editar y borrar cada nota, y vaciar la conversación, desde el propio Producer. Ambas se eliminan con tu cuenta.",
        ],
      },
      {
        id: "facial-information",
        heading: "Información facial (verificación facial)",
        paragraphs: [
          "Algunos modelos de vídeo rechazan fotos de personas reales. Si un personaje eres tú, puedes elegir verificar tu cara para que esos modelos puedan usar tus fotos. Es opcional, solo se ofrece para tu propia cara, y decir que no no afecta a nada más en Picacho.",
          "Qué ocurre: nuestro proveedor BytePlus (BytePlus Pte. Ltd., Singapur), que opera los modelos de vídeo Seedance, graba una breve comprobación facial en vivo en su propia página para confirmar que hay una persona real presente (no una foto, una grabación ni una máscara). Tras una comprobación correcta, BytePlus conserva una imagen de referencia de tu cara. Después se envían a BytePlus hasta tres fotos del personaje que elijas y se comparan con esa imagen de referencia para confirmar que muestran a la misma persona; las fotos que no coinciden no se usan. La información facial implicada son las imágenes y el vídeo de la comprobación y los rasgos faciales extraídos de ellos.",
          "Para qué: solo para que los modelos de vídeo acepten tus propias fotos en los vídeos que creas desde tu propia cuenta. Tu cara verificada nunca se usa para vídeos de otras personas, para elaborar perfiles ni para publicidad, y no se comparte más allá de BytePlus, que la trata solo siguiendo nuestras instrucciones.",
          "Consentimiento y registros: te pedimos tu consentimiento explícito antes de que empiece la comprobación, y guardamos un registro de cuándo diste tu consentimiento y a qué versión de este aviso.",
          "Dónde y durante cuánto tiempo: BytePlus almacena tu información facial en su región del Sudeste Asiático, fuera del Espacio Económico Europeo. Se conserva hasta que retires tu verificación en la página del personaje o elimines tu cuenta. Retirar tu verificación, o eliminar tu cuenta, la elimina en BytePlus; si en ese momento no se puede contactar con BytePlus, lo reintentamos cada día hasta completarlo.",
          "Tus derechos: puedes retirar tu consentimiento en cualquier momento en la página del personaje, lo que detiene el tratamiento de inmediato. Para acceder a tu información facial, corregirla o eliminarla, o para cualquier otra solicitud sobre ella, escríbenos al correo de soporte que aparece en Ajustes: las solicitudes se dirigen a nosotros, no a BytePlus.",
        ],
      },
      {
        heading: "Cookies y analítica",
        paragraphs: [
          "Usamos cookies para funcionalidad esencial —mantener tu sesión iniciada, recordar tu tema e idioma— y para analítica básica y respetuosa de la privacidad, como vistas de página y país aproximado, para entender cómo se usa el producto. No vendemos estos datos.",
        ],
      },
      {
        heading: "Con quién compartimos tu información",
        paragraphs: [
          "Compartimos datos con los proveedores de servicios que nos ayudan a operar Picacho: nuestro proveedor de base de datos, autenticación y almacenamiento de archivos; nuestro proveedor de hosting; nuestros proveedores de generación por IA; y, una vez habilitado, nuestro procesador de pagos. No vendemos tu información personal a terceros.",
        ],
      },
      {
        heading: "Retención de datos",
        paragraphs: [
          "Conservamos tu cuenta y contenido mientras tu cuenta esté activa. Si eliminas tu cuenta desde Ajustes, tu perfil, personajes, generaciones, notas y proyectos se eliminan permanentemente. Los registros de tráfico anonimizados que no puedan vincularse a ti pueden conservarse con fines analíticos.",
        ],
      },
      {
        heading: "Tus derechos",
        paragraphs: [
          "Puedes ver y editar los datos de tu cuenta, cambiar tu contraseña y eliminar tu cuenta permanentemente en cualquier momento desde Ajustes. Picacho opera desde España, por lo que el Reglamento General de Protección de Datos (RGPD) de la UE se aplica al tratamiento de tus datos personales: tienes derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición. Para ejercerlos, contáctanos en el correo de soporte que aparece en Ajustes y responderemos dentro de los plazos que exige el RGPD. También tienes derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD) o la autoridad de control de tu lugar de residencia.",
        ],
      },
      {
        heading: "Privacidad de menores",
        paragraphs: [
          "Picacho no está dirigido a, ni puede ser usado por, personas menores de 18 años. No recopilamos conscientemente información de menores.",
        ],
      },
      {
        heading: "Seguridad",
        paragraphs: [
          "Usamos prácticas estándar de la industria —conexiones cifradas, controles de acceso y seguridad a nivel de fila en nuestra base de datos— para proteger tu información. Ningún método de almacenamiento o transmisión es 100% seguro.",
        ],
      },
      {
        heading: "Cambios a esta política",
        paragraphs: [
          "Podemos actualizar esta política a medida que el producto evolucione. Actualizaremos la fecha indicada arriba cada vez que lo hagamos.",
        ],
      },
      {
        heading: "Contáctanos",
        paragraphs: [
          "¿Preguntas sobre esta política? Escríbenos al correo de soporte que aparece en Ajustes.",
        ],
      },
    ],
  },
  pt: {
    title: "Política de Privacidade",
    updated: UPDATED.pt,
    intro:
      "Esta Política de Privacidade explica quais informações o Picacho (\"nós\") coleta quando você usa o site e o aplicativo Picacho, como as usamos e quais escolhas você tem.",
    sections: [
      {
        heading: "Responsável pelo tratamento dos dados",
        paragraphs: [
          "O responsável pelo tratamento dos dados do Picacho é a JEAR TECNICA S.A. (NIF A28847549), Paseo de la Castellana 259, 28046 Madrid, Espanha. Você pode falar conosco pelos dados de contato mostrados no topo desta página.",
          "Se você acredita que seus dados foram tratados de forma indevida, também pode apresentar uma reclamação à autoridade espanhola de proteção de dados (AEPD, aepd.es) ou à sua autoridade de controle local na UE.",
        ],
      },
      {
        heading: "Informações que coletamos",
        paragraphs: [
          "Informações da conta: seu e-mail e senha (gerenciados pelo nosso provedor de autenticação) e, opcionalmente, um nome de usuário, empresa e gênero autodeclarado.",
          "Dados de personagens e conteúdo: os perfis de personagem que você cria (características, imagens de referência), os prompts que você escreve, as imagens e vídeos gerados para você, suas notas e a organização dos seus projetos.",
          "Dados de uso: as páginas que você visita e quando, além (assim que o app estiver em produção) de um país aproximado derivado do seu endereço IP, usado para entender o uso do produto.",
          "Relatórios de erro: se o app falhar enquanto você está conectado, guardamos um relatório automático na sua conta — o que deu errado, a página em que você estava, seu navegador e dispositivo, o identificador do próprio navegador (user agent) e o rastreamento técnico, cortado em 1.000 caracteres. Os administradores leem isso para corrigir a falha, e tudo é apagado junto com sua conta. Nada é registrado de visitantes sem sessão.",
          "Cookies: pequenos identificadores usados para lembrar seu tema e idioma e, para visitantes sem login, um ID de visitante anônimo para análises básicas de tráfego.",
          "Informações de pagamento: os dados de pagamento são coletados e processados diretamente pelo nosso processador de pagamentos, a Stripe. Nunca vemos nem armazenamos o número completo do seu cartão — mantemos apenas uma referência ao seu cliente e assinatura na Stripe para gerenciar seu plano.",
        ],
      },
      {
        heading: "Como usamos suas informações",
        paragraphs: [
          "Para fornecer e operar o serviço — executar o pipeline de geração, armazenar seu conteúdo e manter você conectado.",
          "Para manter e melhorar a confiabilidade, incluindo estatísticas agregadas de uso sobre quais recursos são utilizados.",
          "Para nos comunicarmos com você sobre sua conta.",
          "Para detectar abusos e aplicar nossos Termos de Serviço.",
        ],
      },
      {
        heading: "Conteúdo gerado por IA",
        paragraphs: [
          "Os prompts que você envia são enviados a provedores terceirizados de IA para redigir, revisar e gerar seu conteúdo. Esses provedores processam o texto do seu prompt — e, para geração de imagens, uma foto de referência caso você tenha adicionado uma — para produzir um resultado. Não controlamos como esses provedores lidam com os dados além dos termos dos nossos acordos com eles.",
          "As imagens e vídeos gerados são armazenados em nosso armazenamento em nuvem e são acessíveis apenas à sua conta e aos administradores do Picacho, para fins de suporte e segurança.",
        ],
      },
      {
        heading: "Voz e o assistente",
        paragraphs: [
          "Se você usar um recurso de microfone (o microfone do compositor, ou falar com o Producer), sua gravação é enviada ao nosso provedor de IA, a OpenAI, para ser convertida em texto. O Picacho não armazena a gravação; apenas o texto resultante é mantido, como parte do seu prompt ou da sua conversa. Quando o Producer responde em voz alta, a resposta é enviada ao nosso provedor de voz, a ElevenLabs (por meio da fal), para ser convertida em fala; se não estiver disponível, a OpenAI faz isso. O microfone só é usado depois que você toca em um botão de microfone e permite o acesso.",
          "O Producer, o assistente pessoal das contas Elite, guarda a sua conversa com ele e as notas curtas que escreve sobre a sua forma de trabalhar, para continuar de onde você parou. Você pode ler, editar e apagar cada nota, e limpar a conversa, no próprio Producer. Ambas são excluídas junto com a sua conta.",
        ],
      },
      {
        id: "facial-information",
        heading: "Informações faciais (verificação facial)",
        paragraphs: [
          "Alguns modelos de vídeo recusam fotos de pessoas reais. Se um personagem for você, pode optar por verificar seu rosto para que esses modelos possam usar suas fotos. É opcional, só é oferecido para o seu próprio rosto, e recusar não afeta nada mais no Picacho.",
          "O que acontece: nosso fornecedor BytePlus (BytePlus Pte. Ltd., Singapura), que opera os modelos de vídeo Seedance, grava uma breve verificação facial ao vivo em sua própria página para confirmar que há uma pessoa real presente (não uma foto, uma gravação ou uma máscara). Após uma verificação bem-sucedida, a BytePlus guarda uma imagem de referência do seu rosto. Em seguida, até três fotos do personagem que você escolher são enviadas à BytePlus e comparadas com essa imagem de referência para confirmar que mostram a mesma pessoa; fotos que não correspondem não são usadas. As informações faciais envolvidas são as imagens e o vídeo da verificação e as características faciais extraídas deles.",
          "Para quê: apenas para que os modelos de vídeo aceitem suas próprias fotos nos vídeos que você cria na sua própria conta. Seu rosto verificado nunca é usado em vídeos de outras pessoas, para criação de perfis ou publicidade, e não é compartilhado além da BytePlus, que o trata apenas segundo nossas instruções.",
          "Consentimento e registros: pedimos seu consentimento explícito antes de a verificação começar e guardamos um registro de quando você consentiu e a qual versão deste aviso.",
          "Onde e por quanto tempo: a BytePlus armazena suas informações faciais em sua região do Sudeste Asiático, fora do Espaço Econômico Europeu. Elas são mantidas até você remover sua verificação na página do personagem ou excluir sua conta. Remover a verificação, ou excluir a conta, as exclui na BytePlus; se a BytePlus não puder ser contatada nesse momento, tentamos novamente todos os dias até concluir.",
          "Seus direitos: você pode retirar seu consentimento a qualquer momento na página do personagem, o que interrompe o tratamento imediatamente. Para acessar, corrigir ou excluir suas informações faciais, ou para qualquer outro pedido sobre elas, fale conosco pelo e-mail de suporte exibido em Configurações — os pedidos são dirigidos a nós, não à BytePlus.",
        ],
      },
      {
        heading: "Cookies e análises",
        paragraphs: [
          "Usamos cookies para funcionalidades essenciais — manter você conectado, lembrar seu tema e idioma — e para análises básicas e respeitosas da privacidade, como visualizações de página e país aproximado, para entender como o produto é usado. Não vendemos esses dados.",
        ],
      },
      {
        heading: "Com quem compartilhamos suas informações",
        paragraphs: [
          "Compartilhamos dados com os provedores de serviço que nos ajudam a operar o Picacho: nosso provedor de banco de dados, autenticação e armazenamento de arquivos; nosso provedor de hospedagem; nossos provedores de geração por IA; e, quando habilitado, nosso processador de pagamentos. Não vendemos suas informações pessoais a terceiros.",
        ],
      },
      {
        heading: "Retenção de dados",
        paragraphs: [
          "Mantemos sua conta e conteúdo enquanto sua conta estiver ativa. Se você excluir sua conta em Configurações, seu perfil, personagens, gerações, notas e projetos são excluídos permanentemente. Registros de tráfego anonimizados que não podem ser vinculados a você podem ser mantidos para fins analíticos.",
        ],
      },
      {
        heading: "Seus direitos",
        paragraphs: [
          "Você pode visualizar e editar os dados da sua conta, alterar sua senha e excluir sua conta permanentemente a qualquer momento em Configurações. O Picacho opera a partir da Espanha, portanto o Regulamento Geral de Proteção de Dados (GDPR) da UE se aplica ao tratamento dos seus dados pessoais: você tem direitos de acesso, retificação, exclusão, limitação, portabilidade e oposição. Para exercê-los, entre em contato pelo e-mail de suporte exibido em Configurações e responderemos dentro dos prazos exigidos pelo GDPR. Você também tem o direito de apresentar uma reclamação à autoridade espanhola de proteção de dados (AEPD) ou à autoridade supervisora do seu local de residência.",
        ],
      },
      {
        heading: "Privacidade infantil",
        paragraphs: [
          "O Picacho não é direcionado a, nem pode ser usado por, pessoas menores de 18 anos. Não coletamos intencionalmente informações de menores.",
        ],
      },
      {
        heading: "Segurança",
        paragraphs: [
          "Usamos práticas padrão do setor — conexões criptografadas, controles de acesso e segurança em nível de linha em nosso banco de dados — para proteger suas informações. Nenhum método de armazenamento ou transmissão é 100% seguro.",
        ],
      },
      {
        heading: "Alterações a esta política",
        paragraphs: [
          "Podemos atualizar esta política conforme o produto evolui. Atualizaremos a data acima sempre que o fizermos.",
        ],
      },
      {
        heading: "Fale conosco",
        paragraphs: [
          "Dúvidas sobre esta política? Entre em contato pelo e-mail de suporte listado em Configurações.",
        ],
      },
    ],
  },
  it: {
    title: "Informativa sulla privacy",
    updated: UPDATED.it,
    intro:
      "Questa Informativa sulla privacy spiega quali informazioni Picacho (\"noi\") raccoglie quando utilizzi il sito e l'app Picacho, come le utilizziamo e quali scelte hai a disposizione.",
    sections: [
      {
        heading: "Titolare del trattamento",
        paragraphs: [
          "Il titolare del trattamento dei dati di Picacho è JEAR TECNICA S.A. (NIF A28847549), Paseo de la Castellana 259, 28046 Madrid, Spagna. Puoi contattarci tramite i recapiti mostrati in cima a questa pagina.",
          "Se ritieni che i tuoi dati siano stati trattati in modo improprio, puoi anche presentare un reclamo all'autorità spagnola per la protezione dei dati (AEPD, aepd.es) o alla tua autorità di controllo locale nell'UE.",
        ],
      },
      {
        heading: "Informazioni che raccogliamo",
        paragraphs: [
          "Informazioni sull'account: la tua email e password (gestite dal nostro fornitore di autenticazione) e, facoltativamente, un nome utente, azienda e genere autodichiarato.",
          "Dati sui personaggi e sui contenuti: i profili personaggio che crei (tratti, immagini di riferimento), i prompt che scrivi, le immagini e i video generati per te, le tue note e l'organizzazione dei tuoi progetti.",
          "Dati di utilizzo: le pagine che visiti e quando, oltre (una volta che l'app sarà in produzione) a un paese approssimativo derivato dal tuo indirizzo IP, usato per capire l'utilizzo del prodotto.",
          "Segnalazioni di errore: se l'app va in errore mentre hai la sessione attiva, registriamo una segnalazione automatica sul tuo account — che cosa non ha funzionato, la pagina in cui eri, il tuo browser e dispositivo, l'identificativo del browser stesso (user agent) e la traccia tecnica, tagliata a 1.000 caratteri. Gli amministratori le leggono per correggere il guasto e vengono cancellate insieme al tuo account. Nulla viene registrato per i visitatori non autenticati.",
          "Cookie: piccoli identificatori usati per ricordare il tuo tema e la tua lingua e, per i visitatori non registrati, un ID visitatore anonimo per analisi di base del traffico.",
          "Informazioni di pagamento: i dati di pagamento sono raccolti ed elaborati direttamente dal nostro processore di pagamenti, Stripe. Non vediamo né memorizziamo mai il numero completo della tua carta — conserviamo solo un riferimento al tuo cliente e abbonamento Stripe per gestire il tuo piano.",
        ],
      },
      {
        heading: "Come utilizziamo le tue informazioni",
        paragraphs: [
          "Per fornire e gestire il servizio — eseguire la pipeline di generazione, memorizzare i tuoi contenuti e mantenerti connesso.",
          "Per mantenere e migliorare l'affidabilità, incluse statistiche aggregate sull'utilizzo delle funzionalità.",
          "Per comunicare con te riguardo al tuo account.",
          "Per rilevare abusi e far rispettare i nostri Termini di servizio.",
        ],
      },
      {
        heading: "Contenuti generati dall'IA",
        paragraphs: [
          "I prompt che invii vengono trasmessi a fornitori terzi di IA per redigere, revisionare e generare i tuoi contenuti. Questi fornitori elaborano il testo del tuo prompt — e, per la generazione di immagini, una foto di riferimento se ne hai aggiunta una — per produrre un risultato. Non controlliamo come questi fornitori gestiscono altrimenti i dati oltre ai termini dei nostri accordi con loro.",
          "Le immagini e i video generati sono memorizzati nel nostro spazio di archiviazione cloud e sono accessibili solo al tuo account e agli amministratori di Picacho, per finalità di supporto e sicurezza.",
        ],
      },
      {
        heading: "La voce e l'assistente",
        paragraphs: [
          "Se usi una funzione del microfono (il microfono del compositore, o parlare con il Producer), la tua registrazione viene inviata al nostro fornitore di IA, OpenAI, per essere trasformata in testo. Picacho non conserva la registrazione; viene mantenuto solo il testo risultante, come parte del tuo prompt o della tua conversazione. Quando il Producer risponde a voce, la sua risposta viene inviata al nostro fornitore di voce, ElevenLabs (tramite fal), per essere trasformata in parlato; se non è disponibile, lo fa OpenAI. Il microfono viene usato solo dopo che tocchi un pulsante del microfono e ne consenti l'accesso.",
          "Il Producer, l'assistente personale degli account Elite, conserva la tua conversazione con lui e le brevi note che scrive sul tuo modo di lavorare, per riprendere da dove avevi lasciato. Puoi leggere, modificare ed eliminare ogni nota, e cancellare la conversazione, dal Producer stesso. Entrambe vengono eliminate insieme al tuo account.",
        ],
      },
      {
        id: "facial-information",
        heading: "Informazioni facciali (verifica del volto)",
        paragraphs: [
          "Alcuni modelli video rifiutano le foto di persone reali. Se un personaggio sei tu, puoi scegliere di verificare il tuo volto perché quei modelli possano usare le tue foto. È facoltativo, è offerto solo per il tuo volto e dire di no non influisce su nient'altro in Picacho.",
          "Cosa succede: il nostro fornitore BytePlus (BytePlus Pte. Ltd., Singapore), che gestisce i modelli video Seedance, registra un breve controllo del volto dal vivo sulla propria pagina per confermare che è presente una persona reale (non una foto, una registrazione o una maschera). Dopo un controllo riuscito, BytePlus conserva un'immagine di riferimento del tuo volto. Fino a tre foto del personaggio che scegli vengono poi inviate a BytePlus e confrontate con quell'immagine per confermare che ritraggono la stessa persona; le foto che non corrispondono non vengono usate. Le informazioni facciali coinvolte sono le immagini e il video del controllo e le caratteristiche del volto estratte da essi.",
          "Perché: solo perché i modelli video accettino le tue foto nei video che crei dal tuo account. Il tuo volto verificato non viene mai usato per i video di altri, per la profilazione o per la pubblicità, e non viene condiviso oltre BytePlus, che lo tratta solo secondo le nostre istruzioni.",
          "Consenso e registrazioni: ti chiediamo il consenso esplicito prima che il controllo inizi e conserviamo una registrazione di quando hai dato il consenso e a quale versione di questa informativa.",
          "Dove e per quanto tempo: BytePlus conserva le tue informazioni facciali nella sua regione del Sud-est asiatico, fuori dallo Spazio economico europeo. Sono conservate finché non rimuovi la verifica dalla pagina del personaggio o elimini il tuo account. Rimuovere la verifica, o eliminare l'account, le elimina presso BytePlus; se in quel momento BytePlus non è raggiungibile, riproviamo ogni giorno finché non è fatto.",
          "I tuoi diritti: puoi revocare il consenso in qualsiasi momento dalla pagina del personaggio, il che interrompe subito il trattamento. Per accedere, correggere o eliminare le tue informazioni facciali, o per qualsiasi altra richiesta al riguardo, scrivici all'email di supporto indicata nelle Impostazioni: le richieste vanno rivolte a noi, non a BytePlus.",
        ],
      },
      {
        heading: "Cookie e analisi",
        paragraphs: [
          "Utilizziamo cookie per funzionalità essenziali — restare connessi, ricordare il tema e la lingua — e per analisi di base rispettose della privacy, come visualizzazioni di pagina e paese approssimativo, per capire come viene utilizzato il prodotto. Non vendiamo questi dati.",
        ],
      },
      {
        heading: "Con chi condividiamo le tue informazioni",
        paragraphs: [
          "Condividiamo i dati con i fornitori di servizi che ci aiutano a gestire Picacho: il nostro fornitore di database, autenticazione e archiviazione file; il nostro fornitore di hosting; i nostri fornitori di generazione IA; e, una volta attivato, il nostro processore di pagamenti. Non vendiamo le tue informazioni personali a terzi.",
        ],
      },
      {
        heading: "Conservazione dei dati",
        paragraphs: [
          "Conserviamo il tuo account e i tuoi contenuti finché il tuo account è attivo. Se elimini il tuo account dalle Impostazioni, il tuo profilo, personaggi, generazioni, note e progetti vengono eliminati permanentemente. I registri di traffico anonimizzati che non possono essere ricollegati a te possono essere conservati a fini analitici.",
        ],
      },
      {
        heading: "I tuoi diritti",
        paragraphs: [
          "Puoi visualizzare e modificare i dati del tuo account, cambiare la password ed eliminare permanentemente il tuo account in qualsiasi momento dalle Impostazioni. Picacho opera dalla Spagna, quindi il Regolamento Generale sulla Protezione dei Dati (GDPR) dell'UE si applica al trattamento dei tuoi dati personali: hai diritti di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione. Per esercitarli, contattaci all'indirizzo email di supporto indicato nelle Impostazioni e risponderemo entro i termini previsti dal GDPR. Hai anche il diritto di presentare un reclamo all'autorità spagnola per la protezione dei dati (AEPD) o all'autorità di controllo del tuo luogo di residenza.",
        ],
      },
      {
        heading: "Privacy dei minori",
        paragraphs: [
          "Picacho non è rivolto a, e non può essere utilizzato da, persone di età inferiore ai 18 anni. Non raccogliamo consapevolmente informazioni da minori.",
        ],
      },
      {
        heading: "Sicurezza",
        paragraphs: [
          "Utilizziamo pratiche standard del settore — connessioni crittografate, controlli di accesso e sicurezza a livello di riga nel nostro database — per proteggere le tue informazioni. Nessun metodo di archiviazione o trasmissione è sicuro al 100%.",
        ],
      },
      {
        heading: "Modifiche a questa informativa",
        paragraphs: [
          "Potremmo aggiornare questa informativa con l'evolversi del prodotto. Aggiorneremo la data sopra indicata ogni volta che lo faremo.",
        ],
      },
      {
        heading: "Contattaci",
        paragraphs: [
          "Domande su questa informativa? Scrivici all'indirizzo email di supporto indicato nelle Impostazioni.",
        ],
      },
    ],
  },
};

export default privacy;
