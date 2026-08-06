import type { Locale } from "@/lib/i18n/locales";
import type { LegalDoc } from "./types";

// This governs everything generated or uploaded through Picacho, in
// addition to the Terms of Service. The two rules below (real-people
// likeness, and anything involving minors) are enforced strictly and
// without exception — see the "emphasis" flags used on the page.
const UPDATED = "August 5, 2026";

const contentPolicy: Record<Locale, LegalDoc> = {
  en: {
    title: "Content Policy",
    updated: UPDATED,
    intro:
      "This Content Policy sets the rules for everything you create, upload, or request through Picacho. It applies in addition to our Terms of Service, and every account is expected to follow it without exception.",
    sections: [
      {
        heading: "Real people & likeness",
        emphasis: "high",
        paragraphs: [
          "You may not create a character based on, or generate content depicting, any real, identifiable person — public figure, celebrity, or private individual — without their explicit, verifiable consent.",
          "If a character is based on you, by submitting it you are confirming that you are that person and have the right to use your own likeness this way.",
          "Impersonation, non-consensual likeness use, and \"deepfake\"-style content that depicts a real person without consent are strictly prohibited and will result in content removal and account action, up to and including immediate termination.",
        ],
      },
      {
        heading: "Zero tolerance: content involving minors",
        emphasis: "critical",
        paragraphs: [
          "Picacho has zero tolerance, with no exceptions, for any content that sexualizes, exploits, or endangers minors in any way. This includes content that appears to depict a minor even if described as an adult, stylized or animated depictions, and any \"aged-up\" framing used to try to work around this rule.",
          "Any attempt to generate, request, or upload this kind of content results in immediate, permanent account termination. Where required or appropriate by law, we report violations to the National Center for Missing & Exploited Children (NCMEC) and relevant law enforcement, and we cooperate fully with any resulting investigation.",
          "This policy is enforced strictly and without exception, regardless of intent, framing, or context provided.",
        ],
      },
      {
        heading: "Other prohibited content",
        paragraphs: [
          "Beyond the above, you may not use Picacho to generate content that: promotes violence, harassment, or hatred against individuals or groups; constitutes non-consensual intimate imagery; facilitates illegal activity; infringes someone else's intellectual property; or is otherwise illegal where you live.",
        ],
      },
      {
        heading: "Enforcement",
        paragraphs: [
          "Violations may result in content removal, a warning, temporary suspension, or immediate permanent termination, depending on severity. Violations involving real-people likeness without consent or anything involving minors are treated as severe and typically result in immediate termination without prior warning.",
          "We cooperate with law enforcement investigations where legally required or appropriate.",
        ],
      },
      {
        heading: "Reporting a violation",
        paragraphs: [
          "If you believe content on Picacho violates this policy, contact us immediately at the support email listed in Settings with as much detail as possible. We investigate every report.",
        ],
      },
      {
        heading: "Your responsibility",
        paragraphs: [
          "You are solely responsible for ensuring you have the right to use any likeness, reference photo, or character concept you submit. Picacho's automated systems cannot verify consent on your behalf — each time you generate content, you are representing and warranting that you have the right to do so under this policy.",
        ],
      },
    ],
  },
  es: {
    title: "Política de contenido",
    updated: UPDATED,
    intro:
      "Esta Política de contenido establece las reglas para todo lo que crees, subas o solicites a través de Picacho. Se aplica además de nuestros Términos de servicio, y se espera que todas las cuentas la cumplan sin excepción.",
    sections: [
      {
        heading: "Personas reales e imagen personal",
        emphasis: "high",
        paragraphs: [
          "No puedes crear un personaje basado en, ni generar contenido que represente a, ninguna persona real e identificable —figura pública, famoso o individuo privado— sin su consentimiento explícito y verificable.",
          "Si un personaje está basado en ti, al enviarlo confirmas que eres esa persona y que tienes derecho a usar tu propia imagen de esta manera.",
          "La suplantación de identidad, el uso no consentido de la imagen de alguien y el contenido tipo \"deepfake\" que represente a una persona real sin consentimiento están estrictamente prohibidos y darán lugar a la eliminación del contenido y medidas sobre la cuenta, incluida la cancelación inmediata.",
        ],
      },
      {
        heading: "Tolerancia cero: contenido que involucre a menores",
        emphasis: "critical",
        paragraphs: [
          "Picacho tiene tolerancia cero, sin excepciones, ante cualquier contenido que sexualice, explote o ponga en peligro a menores de cualquier forma. Esto incluye contenido que parezca representar a un menor aunque se describa como adulto, representaciones estilizadas o animadas, y cualquier planteamiento de \"envejecimiento\" usado para intentar evadir esta regla.",
          "Cualquier intento de generar, solicitar o subir este tipo de contenido resulta en la cancelación inmediata y permanente de la cuenta. Cuando la ley lo exija o sea apropiado, reportamos las infracciones al Centro Nacional para Niños Desaparecidos y Explotados (NCMEC) y a las autoridades correspondientes, y cooperamos plenamente con cualquier investigación resultante.",
          "Esta política se aplica de forma estricta y sin excepción, sin importar la intención, el planteamiento o el contexto proporcionado.",
        ],
      },
      {
        heading: "Otro contenido prohibido",
        paragraphs: [
          "Además de lo anterior, no puedes usar Picacho para generar contenido que: promueva violencia, acoso u odio contra personas o grupos; constituya imágenes íntimas no consentidas; facilite actividades ilegales; infrinja la propiedad intelectual de terceros; o sea ilegal en el lugar donde vives.",
        ],
      },
      {
        heading: "Aplicación de la política",
        paragraphs: [
          "Las infracciones pueden resultar en la eliminación del contenido, una advertencia, suspensión temporal o cancelación inmediata y permanente, según la gravedad. Las infracciones relacionadas con el uso de la imagen de personas reales sin consentimiento o cualquier cosa que involucre a menores se consideran graves y normalmente resultan en cancelación inmediata sin aviso previo.",
          "Cooperamos con investigaciones de las autoridades cuando la ley lo exija o sea apropiado.",
        ],
      },
      {
        heading: "Cómo reportar una infracción",
        paragraphs: [
          "Si crees que algún contenido en Picacho infringe esta política, contáctanos de inmediato al correo de soporte que aparece en Ajustes, con la mayor cantidad de detalles posible. Investigamos cada reporte.",
        ],
      },
      {
        heading: "Tu responsabilidad",
        paragraphs: [
          "Eres el único responsable de asegurarte de tener derecho a usar cualquier imagen, foto de referencia o concepto de personaje que envíes. Los sistemas automatizados de Picacho no pueden verificar el consentimiento en tu nombre: cada vez que generas contenido, estás declarando y garantizando que tienes derecho a hacerlo conforme a esta política.",
        ],
      },
    ],
  },
  pt: {
    title: "Política de Conteúdo",
    updated: UPDATED,
    intro:
      "Esta Política de Conteúdo define as regras para tudo que você cria, envia ou solicita através do Picacho. Ela se aplica em conjunto com nossos Termos de Serviço, e espera-se que todas as contas a sigam sem exceção.",
    sections: [
      {
        heading: "Pessoas reais e imagem",
        emphasis: "high",
        paragraphs: [
          "Você não pode criar um personagem baseado em, nem gerar conteúdo que retrate, nenhuma pessoa real e identificável — figura pública, celebridade ou indivíduo particular — sem o seu consentimento explícito e verificável.",
          "Se um personagem for baseado em você, ao enviá-lo você confirma que é essa pessoa e que tem o direito de usar sua própria imagem dessa forma.",
          "Personificação, uso não consensual de imagem, e conteúdo do tipo \"deepfake\" que retrate uma pessoa real sem consentimento são estritamente proibidos e resultarão na remoção do conteúdo e em ações contra a conta, podendo incluir o encerramento imediato.",
        ],
      },
      {
        heading: "Tolerância zero: conteúdo envolvendo menores",
        emphasis: "critical",
        paragraphs: [
          "O Picacho tem tolerância zero, sem exceções, para qualquer conteúdo que sexualize, explore ou coloque em risco menores de qualquer forma. Isso inclui conteúdo que pareça retratar um menor mesmo que descrito como adulto, representações estilizadas ou animadas, e qualquer enquadramento de \"envelhecimento\" usado para tentar contornar esta regra.",
          "Qualquer tentativa de gerar, solicitar ou enviar esse tipo de conteúdo resulta no encerramento imediato e permanente da conta. Quando exigido ou apropriado por lei, reportamos violações ao National Center for Missing & Exploited Children (NCMEC) e às autoridades competentes, e cooperamos plenamente com qualquer investigação resultante.",
          "Esta política é aplicada de forma estrita e sem exceção, independentemente da intenção, do enquadramento ou do contexto fornecido.",
        ],
      },
      {
        heading: "Outros conteúdos proibidos",
        paragraphs: [
          "Além do exposto, você não pode usar o Picacho para gerar conteúdo que: promova violência, assédio ou ódio contra indivíduos ou grupos; constitua imagens íntimas não consensuais; facilite atividades ilegais; infrinja a propriedade intelectual de terceiros; ou seja ilegal no local onde você mora.",
        ],
      },
      {
        heading: "Aplicação da política",
        paragraphs: [
          "As violações podem resultar em remoção de conteúdo, advertência, suspensão temporária ou encerramento imediato e permanente, dependendo da gravidade. Violações envolvendo uso de imagem de pessoas reais sem consentimento ou qualquer coisa envolvendo menores são tratadas como graves e normalmente resultam em encerramento imediato sem aviso prévio.",
          "Cooperamos com investigações das autoridades quando exigido ou apropriado por lei.",
        ],
      },
      {
        heading: "Como denunciar uma violação",
        paragraphs: [
          "Se você acredita que algum conteúdo no Picacho viola esta política, entre em contato imediatamente pelo e-mail de suporte listado em Configurações, com o máximo de detalhes possível. Investigamos todas as denúncias.",
        ],
      },
      {
        heading: "Sua responsabilidade",
        paragraphs: [
          "Você é o único responsável por garantir que tem o direito de usar qualquer imagem, foto de referência ou conceito de personagem que enviar. Os sistemas automatizados do Picacho não podem verificar o consentimento em seu nome — cada vez que você gera conteúdo, está declarando e garantindo que tem o direito de fazê-lo conforme esta política.",
        ],
      },
    ],
  },
  it: {
    title: "Politica sui contenuti",
    updated: UPDATED,
    intro:
      "Questa Politica sui contenuti stabilisce le regole per tutto ciò che crei, carichi o richiedi tramite Picacho. Si applica in aggiunta ai nostri Termini di servizio, e ogni account è tenuto a rispettarla senza eccezioni.",
    sections: [
      {
        heading: "Persone reali e immagine",
        emphasis: "high",
        paragraphs: [
          "Non puoi creare un personaggio basato su, né generare contenuti che ritraggano, alcuna persona reale e identificabile — figura pubblica, celebrità o privato cittadino — senza il suo consenso esplicito e verificabile.",
          "Se un personaggio è basato su di te, inviandolo confermi di essere quella persona e di avere il diritto di utilizzare la tua immagine in questo modo.",
          "L'impersonificazione, l'uso non consensuale dell'immagine altrui e i contenuti in stile \"deepfake\" che ritraggono una persona reale senza consenso sono severamente vietati e comporteranno la rimozione dei contenuti e provvedimenti sull'account, fino alla chiusura immediata.",
        ],
      },
      {
        heading: "Tolleranza zero: contenuti che coinvolgono minori",
        emphasis: "critical",
        paragraphs: [
          "Picacho ha tolleranza zero, senza eccezioni, per qualsiasi contenuto che sessualizzi, sfrutti o metta in pericolo minori in qualsiasi modo. Questo include contenuti che sembrano ritrarre un minore anche se descritto come adulto, rappresentazioni stilizzate o animate, e qualsiasi inquadramento di \"invecchiamento\" usato per tentare di aggirare questa regola.",
          "Qualsiasi tentativo di generare, richiedere o caricare questo tipo di contenuto comporta la chiusura immediata e permanente dell'account. Quando richiesto o opportuno per legge, segnaliamo le violazioni al National Center for Missing & Exploited Children (NCMEC) e alle autorità competenti, e collaboriamo pienamente con qualsiasi indagine risultante.",
          "Questa politica viene applicata rigorosamente e senza eccezioni, indipendentemente dall'intenzione, dall'inquadramento o dal contesto fornito.",
        ],
      },
      {
        heading: "Altri contenuti vietati",
        paragraphs: [
          "Oltre a quanto sopra, non puoi usare Picacho per generare contenuti che: promuovano violenza, molestie o odio contro individui o gruppi; costituiscano immagini intime non consensuali; agevolino attività illegali; violino la proprietà intellettuale altrui; o siano altrimenti illegali nel luogo in cui vivi.",
        ],
      },
      {
        heading: "Applicazione della politica",
        paragraphs: [
          "Le violazioni possono comportare la rimozione dei contenuti, un avvertimento, una sospensione temporanea o la chiusura immediata e permanente, a seconda della gravità. Le violazioni relative all'uso dell'immagine di persone reali senza consenso o a qualsiasi cosa coinvolga minori sono considerate gravi e di norma comportano la chiusura immediata senza preavviso.",
          "Collaboriamo con le indagini delle forze dell'ordine quando richiesto o opportuno per legge.",
        ],
      },
      {
        heading: "Segnalare una violazione",
        paragraphs: [
          "Se ritieni che un contenuto su Picacho violi questa politica, contattaci immediatamente all'indirizzo email di supporto indicato nelle Impostazioni, con quanti più dettagli possibile. Esaminiamo ogni segnalazione.",
        ],
      },
      {
        heading: "La tua responsabilità",
        paragraphs: [
          "Sei l'unico responsabile di assicurarti di avere il diritto di utilizzare qualsiasi immagine, foto di riferimento o concept di personaggio che invii. I sistemi automatizzati di Picacho non possono verificare il consenso per tuo conto: ogni volta che generi contenuti, dichiari e garantisci di avere il diritto di farlo ai sensi di questa politica.",
        ],
      },
    ],
  },
};

export default contentPolicy;
