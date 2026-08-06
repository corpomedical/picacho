import type { Locale } from "@/lib/i18n/locales";
import type { LegalDoc } from "./types";

const UPDATED = "August 5, 2026";

const terms: Record<Locale, LegalDoc> = {
  en: {
    title: "Terms of Service",
    updated: UPDATED,
    intro:
      "These Terms govern your use of Picacho. By creating an account or using the service, you agree to them.",
    sections: [
      {
        heading: "Using Picacho",
        paragraphs: [
          "You must be 18 or older to create an account. You're responsible for keeping your login credentials secure and for all activity that happens under your account.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "You may not use Picacho to generate, upload, or request content that: depicts a real, identifiable person without their consent, including using their likeness for a character; sexualizes a minor in any way — this is strictly prohibited and will be reported to the relevant authorities; promotes violence, harassment, or hatred against individuals or groups; infringes someone else's intellectual property; or is otherwise illegal where you live.",
          "We may suspend or terminate accounts that violate this policy, with or without notice depending on severity.",
        ],
      },
      {
        heading: "Your content",
        paragraphs: [
          "You retain ownership of the prompts and character details you provide and, to the extent permitted by our AI providers' own terms, the content generated for you. You're responsible for how you use generated content, including complying with any laws about AI-generated or synthetic media disclosure that apply to you.",
        ],
      },
      {
        heading: "AI-generated content — no guarantee of accuracy",
        paragraphs: [
          "Picacho is AI and can make mistakes. Generated content may be inaccurate, unexpected, or not match your request despite our draft/review/validate pipeline. Review generated content before relying on or publishing it.",
        ],
      },
      {
        heading: "Subscription & billing",
        paragraphs: [
          "Paid plans and billing are not yet active. Once available, plan pricing, generation limits, and billing terms will be described on our Pricing page and processed through our payment provider. You'll be able to cancel at any time from Settings.",
        ],
      },
      {
        heading: "Account termination",
        paragraphs: [
          "You may delete your account at any time from Settings, which permanently removes your data as described in our Privacy Policy. We may suspend or terminate accounts that violate these Terms, or for extended inactivity, with notice where practical.",
        ],
      },
      {
        heading: "Disclaimers & limitation of liability",
        paragraphs: [
          "Picacho is provided \"as is\" without warranties of any kind. To the fullest extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from your use of the service.",
        ],
      },
      {
        heading: "Governing law",
        paragraphs: [
          "This section is a placeholder — the governing jurisdiction will be added once finalized.",
        ],
      },
      {
        heading: "Changes to these Terms",
        paragraphs: [
          "We may update these Terms as the product evolves. Continued use after a change means you accept the updated Terms.",
        ],
      },
      {
        heading: "Contact us",
        paragraphs: ["Questions about these Terms? Reach us at the support email listed in Settings."],
      },
    ],
  },
  es: {
    title: "Términos de servicio",
    updated: UPDATED,
    intro:
      "Estos Términos rigen tu uso de Picacho. Al crear una cuenta o usar el servicio, los aceptas.",
    sections: [
      {
        heading: "Uso de Picacho",
        paragraphs: [
          "Debes tener 18 años o más para crear una cuenta. Eres responsable de mantener seguras tus credenciales de acceso y de toda actividad que ocurra bajo tu cuenta.",
        ],
      },
      {
        heading: "Uso aceptable",
        paragraphs: [
          "No puedes usar Picacho para generar, subir o solicitar contenido que: represente a una persona real e identificable sin su consentimiento, incluyendo usar su imagen para un personaje; sexualice a un menor de cualquier forma —esto está estrictamente prohibido y será reportado a las autoridades correspondientes—; promueva violencia, acoso u odio contra personas o grupos; infrinja la propiedad intelectual de terceros; o sea ilegal en el lugar donde vives.",
          "Podemos suspender o cancelar cuentas que infrinjan esta política, con o sin previo aviso según la gravedad.",
        ],
      },
      {
        heading: "Tu contenido",
        paragraphs: [
          "Conservas la propiedad de las instrucciones y detalles de personaje que proporcionas y, en la medida permitida por los propios términos de nuestros proveedores de IA, del contenido generado para ti. Eres responsable de cómo usas el contenido generado, incluyendo el cumplimiento de cualquier ley sobre divulgación de contenido generado por IA o medios sintéticos que te sea aplicable.",
        ],
      },
      {
        heading: "Contenido generado por IA — sin garantía de exactitud",
        paragraphs: [
          "Picacho es IA y puede cometer errores. El contenido generado puede ser inexacto, inesperado o no coincidir con tu solicitud a pesar de nuestro pipeline de redacción/revisión/validación. Revisa el contenido generado antes de confiar en él o publicarlo.",
        ],
      },
      {
        heading: "Suscripción y facturación",
        paragraphs: [
          "Los planes de pago y la facturación aún no están activos. Cuando estén disponibles, los precios de los planes, los límites de generación y los términos de facturación se describirán en nuestra página de Precios y se procesarán a través de nuestro proveedor de pagos. Podrás cancelar en cualquier momento desde Ajustes.",
        ],
      },
      {
        heading: "Cancelación de cuenta",
        paragraphs: [
          "Puedes eliminar tu cuenta en cualquier momento desde Ajustes, lo que elimina permanentemente tus datos según lo descrito en nuestra Política de privacidad. Podemos suspender o cancelar cuentas que infrinjan estos Términos, o por inactividad prolongada, con aviso previo cuando sea posible.",
        ],
      },
      {
        heading: "Renuncias y limitación de responsabilidad",
        paragraphs: [
          "Picacho se proporciona \"tal cual\", sin garantías de ningún tipo. En la medida máxima permitida por la ley, no somos responsables de daños indirectos, incidentales o consecuentes derivados de tu uso del servicio.",
        ],
      },
      {
        heading: "Ley aplicable",
        paragraphs: [
          "Esta sección es un marcador de posición: la jurisdicción aplicable se añadirá una vez definida.",
        ],
      },
      {
        heading: "Cambios a estos Términos",
        paragraphs: [
          "Podemos actualizar estos Términos a medida que el producto evolucione. El uso continuado tras un cambio implica la aceptación de los Términos actualizados.",
        ],
      },
      {
        heading: "Contáctanos",
        paragraphs: [
          "¿Preguntas sobre estos Términos? Escríbenos al correo de soporte que aparece en Ajustes.",
        ],
      },
    ],
  },
  pt: {
    title: "Termos de Serviço",
    updated: UPDATED,
    intro: "Estes Termos regem o uso do Picacho. Ao criar uma conta ou usar o serviço, você concorda com eles.",
    sections: [
      {
        heading: "Usando o Picacho",
        paragraphs: [
          "Você deve ter 18 anos ou mais para criar uma conta. Você é responsável por manter suas credenciais de login seguras e por toda a atividade realizada em sua conta.",
        ],
      },
      {
        heading: "Uso aceitável",
        paragraphs: [
          "Você não pode usar o Picacho para gerar, enviar ou solicitar conteúdo que: retrate uma pessoa real e identificável sem o seu consentimento, incluindo o uso de sua imagem para um personagem; sexualize um menor de qualquer forma — isso é estritamente proibido e será reportado às autoridades competentes; promova violência, assédio ou ódio contra indivíduos ou grupos; infrinja a propriedade intelectual de terceiros; ou seja ilegal no local onde você mora.",
          "Podemos suspender ou encerrar contas que violem esta política, com ou sem aviso prévio, dependendo da gravidade.",
        ],
      },
      {
        heading: "Seu conteúdo",
        paragraphs: [
          "Você mantém a propriedade dos prompts e detalhes de personagem que fornece e, na medida permitida pelos próprios termos dos nossos provedores de IA, do conteúdo gerado para você. Você é responsável por como usa o conteúdo gerado, incluindo o cumprimento de quaisquer leis sobre divulgação de conteúdo gerado por IA ou mídia sintética aplicáveis a você.",
        ],
      },
      {
        heading: "Conteúdo gerado por IA — sem garantia de precisão",
        paragraphs: [
          "O Picacho é IA e pode cometer erros. O conteúdo gerado pode ser impreciso, inesperado ou não corresponder ao seu pedido, apesar do nosso pipeline de rascunho/revisão/validação. Revise o conteúdo gerado antes de confiar nele ou publicá-lo.",
        ],
      },
      {
        heading: "Assinatura e cobrança",
        paragraphs: [
          "Planos pagos e cobrança ainda não estão ativos. Quando disponíveis, os preços dos planos, limites de geração e termos de cobrança serão descritos em nossa página de Preços e processados pelo nosso provedor de pagamentos. Você poderá cancelar a qualquer momento em Configurações.",
        ],
      },
      {
        heading: "Encerramento de conta",
        paragraphs: [
          "Você pode excluir sua conta a qualquer momento em Configurações, o que remove permanentemente seus dados conforme descrito em nossa Política de Privacidade. Podemos suspender ou encerrar contas que violem estes Termos, ou por inatividade prolongada, com aviso prévio quando possível.",
        ],
      },
      {
        heading: "Isenções e limitação de responsabilidade",
        paragraphs: [
          "O Picacho é fornecido \"como está\", sem garantias de qualquer tipo. Na máxima extensão permitida por lei, não somos responsáveis por danos indiretos, incidentais ou consequenciais decorrentes do uso do serviço.",
        ],
      },
      {
        heading: "Lei aplicável",
        paragraphs: [
          "Esta seção é um espaço reservado — a jurisdição aplicável será adicionada assim que definida.",
        ],
      },
      {
        heading: "Alterações a estes Termos",
        paragraphs: [
          "Podemos atualizar estes Termos conforme o produto evolui. O uso continuado após uma alteração significa que você aceita os Termos atualizados.",
        ],
      },
      {
        heading: "Fale conosco",
        paragraphs: [
          "Dúvidas sobre estes Termos? Entre em contato pelo e-mail de suporte listado em Configurações.",
        ],
      },
    ],
  },
  it: {
    title: "Termini di servizio",
    updated: UPDATED,
    intro:
      "Questi Termini regolano il tuo utilizzo di Picacho. Creando un account o utilizzando il servizio, li accetti.",
    sections: [
      {
        heading: "Utilizzo di Picacho",
        paragraphs: [
          "Devi avere almeno 18 anni per creare un account. Sei responsabile della sicurezza delle tue credenziali di accesso e di tutte le attività svolte con il tuo account.",
        ],
      },
      {
        heading: "Uso consentito",
        paragraphs: [
          "Non puoi usare Picacho per generare, caricare o richiedere contenuti che: raffigurino una persona reale e identificabile senza il suo consenso, incluso l'uso della sua immagine per un personaggio; sessualizzino in qualsiasi modo un minore — ciò è severamente vietato e sarà segnalato alle autorità competenti; promuovano violenza, molestie o odio contro individui o gruppi; violino la proprietà intellettuale altrui; o siano altrimenti illegali nel luogo in cui vivi.",
          "Potremmo sospendere o chiudere account che violano questa politica, con o senza preavviso a seconda della gravità.",
        ],
      },
      {
        heading: "I tuoi contenuti",
        paragraphs: [
          "Mantieni la proprietà dei prompt e dei dettagli del personaggio che fornisci e, nella misura consentita dai termini dei nostri fornitori di IA, del contenuto generato per te. Sei responsabile di come utilizzi i contenuti generati, incluso il rispetto di eventuali leggi sulla divulgazione di contenuti generati da IA o media sintetici a te applicabili.",
        ],
      },
      {
        heading: "Contenuti generati dall'IA — nessuna garanzia di accuratezza",
        paragraphs: [
          "Picacho è un'IA e può commettere errori. I contenuti generati potrebbero essere imprecisi, inaspettati o non corrispondere alla tua richiesta nonostante la nostra pipeline di bozza/revisione/validazione. Rivedi i contenuti generati prima di farvi affidamento o pubblicarli.",
        ],
      },
      {
        heading: "Abbonamento e fatturazione",
        paragraphs: [
          "I piani a pagamento e la fatturazione non sono ancora attivi. Una volta disponibili, i prezzi dei piani, i limiti di generazione e i termini di fatturazione saranno descritti nella nostra pagina Prezzi ed elaborati tramite il nostro fornitore di pagamenti. Potrai annullare in qualsiasi momento dalle Impostazioni.",
        ],
      },
      {
        heading: "Chiusura dell'account",
        paragraphs: [
          "Puoi eliminare il tuo account in qualsiasi momento dalle Impostazioni, rimuovendo permanentemente i tuoi dati come descritto nella nostra Informativa sulla privacy. Potremmo sospendere o chiudere account che violano questi Termini, o per inattività prolungata, con preavviso quando possibile.",
        ],
      },
      {
        heading: "Esclusioni di responsabilità e limitazione di responsabilità",
        paragraphs: [
          "Picacho è fornito \"così com'è\", senza garanzie di alcun tipo. Nella misura massima consentita dalla legge, non siamo responsabili per danni indiretti, incidentali o consequenziali derivanti dall'uso del servizio.",
        ],
      },
      {
        heading: "Legge applicabile",
        paragraphs: [
          "Questa sezione è un segnaposto — la giurisdizione applicabile sarà aggiunta una volta definita.",
        ],
      },
      {
        heading: "Modifiche a questi Termini",
        paragraphs: [
          "Potremmo aggiornare questi Termini con l'evolversi del prodotto. L'uso continuato dopo una modifica implica l'accettazione dei Termini aggiornati.",
        ],
      },
      {
        heading: "Contattaci",
        paragraphs: [
          "Domande su questi Termini? Scrivici all'indirizzo email di supporto indicato nelle Impostazioni.",
        ],
      },
    ],
  },
};

export default terms;
