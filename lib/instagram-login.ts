// Starts Instagram Business Login (Instagram API with Instagram Login). client_id must be the
// Instagram app ID from the Instagram product page, not the parent Meta app ID.
export function startInstagramLogin() {
  const params = new URLSearchParams({
    enable_fb_login: "0",
    force_authentication: "1",
    client_id: (process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID || "").trim(),
    redirect_uri: (process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI || "").trim(),
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish",
  })
  window.location.href = `https://www.instagram.com/oauth/authorize?${params}`
}
