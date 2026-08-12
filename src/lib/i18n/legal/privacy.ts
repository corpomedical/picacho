import type { Locale } from "@/lib/i18n/locales";
import type { LegalDoc } from "./types";

// A real, drafted policy reflecting what Picacho actually does today — not
// boilerplate. It is still a draft: see the "not legal advice" note shown
// alongside it on the page, and have an attorney review before launch.
const UPDATED = "August 12, 2026";

const privacy: Record<Locale, LegalDoc> = {
  en: {
    title: "Privacy Policy",
    updated: UPDATED,
    intro:
      "This Privacy Policy explains what information Picacho (\"we\", \"us\") collects when you use the Picacho website and app, how we use it, and the choices you have.",
    sections: [
      {
        heading: "Information we collect",
        paragraphs: [
          "Account information: your email address and password (handled by our authentication provider), and optionally a username, company, and self-reported gender.",
          "Character and content data: the character profiles you create (traits, reference images), the prompts you write, the images and videos generated for you, your notes, and your project organization.",
          "Usage data: pages you visit and when, plus (once the app is deployed to production) an approximate country derived from your IP address, used to understand product usage.",
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
    updated: UPDATED,
    intro:
      "Esta Política de privacidad explica qué información recopila Picacho (\"nosotros\") cuando usas el sitio web y la aplicación de Picacho, cómo la usamos y qué opciones tienes.",
    sections: [
      {
        heading: "Información que recopilamos",
        paragraphs: [
          "Información de la cuenta: tu correo electrónico y contraseña (gestionados por nuestro proveedor de autenticación) y, opcionalmente, un nombre de usuario, empresa y género autoinformado.",
          "Datos de personajes y contenido: los perfiles de personaje que creas (rasgos, imágenes de referencia), las instrucciones que escribes, las imágenes y videos generados para ti, tus notas y la organización de tus proyectos.",
          "Datos de uso: las páginas que visitas y cuándo, además (una vez que la app esté desplegada en producción) de un país aproximado derivado de tu dirección IP, usado para entender el uso del producto.",
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
    updated: UPDATED,
    intro:
      "Esta Política de Privacidade explica quais informações o Picacho (\"nós\") coleta quando você usa o site e o aplicativo Picacho, como as usamos e quais escolhas você tem.",
    sections: [
      {
        heading: "Informações que coletamos",
        paragraphs: [
          "Informações da conta: seu e-mail e senha (gerenciados pelo nosso provedor de autenticação) e, opcionalmente, um nome de usuário, empresa e gênero autodeclarado.",
          "Dados de personagens e conteúdo: os perfis de personagem que você cria (características, imagens de referência), os prompts que você escreve, as imagens e vídeos gerados para você, suas notas e a organização dos seus projetos.",
          "Dados de uso: as páginas que você visita e quando, além (assim que o app estiver em produção) de um país aproximado derivado do seu endereço IP, usado para entender o uso do produto.",
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
    updated: UPDATED,
    intro:
      "Questa Informativa sulla privacy spiega quali informazioni Picacho (\"noi\") raccoglie quando utilizzi il sito e l'app Picacho, come le utilizziamo e quali scelte hai a disposizione.",
    sections: [
      {
        heading: "Informazioni che raccogliamo",
        paragraphs: [
          "Informazioni sull'account: la tua email e password (gestite dal nostro fornitore di autenticazione) e, facoltativamente, un nome utente, azienda e genere autodichiarato.",
          "Dati sui personaggi e sui contenuti: i profili personaggio che crei (tratti, immagini di riferimento), i prompt che scrivi, le immagini e i video generati per te, le tue note e l'organizzazione dei tuoi progetti.",
          "Dati di utilizzo: le pagine che visiti e quando, oltre (una volta che l'app sarà in produzione) a un paese approssimativo derivato dal tuo indirizzo IP, usato per capire l'utilizzo del prodotto.",
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
