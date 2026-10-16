const CONTACT_EMAIL = "ceestoremkt@gmail.com"

export const metadata = { title: "Exclusão de dados — CEE Store" }

export default function DataDeletionPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6">Exclusão de dados</h1>
      <p className="text-sm text-muted-foreground mb-8">Data deletion instructions — CEE Webstore (@cee_webstore)</p>

      <section className="space-y-4">
        <p>
          Se você interagiu com a conta <strong>@cee_webstore</strong> no Instagram e quer que seus dados sejam
          excluídos da nossa ferramenta de respostas automáticas, use um dos caminhos abaixo.
        </p>

        <h2 className="text-xl font-semibold mt-6">Como pedir a exclusão</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Pelo Instagram (automático e imediato):</strong> envie uma mensagem direta para @cee_webstore com o
            texto <strong>EXCLUIR MEUS DADOS</strong>. Você recebe uma confirmação na hora.
          </li>
          <li>
            <strong>Por e-mail:</strong> escreva para{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}?subject=Exclus%C3%A3o%20de%20dados`}>{CONTACT_EMAIL}</a>{" "}
            com o assunto <strong>&quot;Exclusão de dados&quot;</strong> e informe o seu nome de usuário do Instagram. Atendemos em
            até 15 dias e confirmamos por e-mail.
          </li>
        </ol>

        <h2 className="text-xl font-semibold mt-6">O que é excluído</h2>
        <p>
          Seu identificador e nome de usuário do Instagram, as etiquetas associadas a você, o histórico de interações
          (comentários, mensagens, toques em botões e cliques), os links enviados a você e as mensagens registradas na
          nossa ferramenta.
        </p>
        <p className="text-sm text-muted-foreground">
          A conversa no próprio Instagram (o que aparece no seu app) é guardada pela Meta e pode ser apagada por você no
          aplicativo. Se você voltar a interagir com a conta depois da exclusão, um novo registro é criado.
        </p>

        <p className="text-sm text-muted-foreground mt-8">
          Veja também a nossa <a className="underline" href="/privacy">Política de Privacidade</a>.
        </p>
      </section>
    </div>
  )
}
