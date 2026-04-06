import type { NextAuthOptions } from 'next-auth'
import KeycloakProvider from 'next-auth/providers/keycloak'

/**
 * Keycloak URL の使い分け（WSL2 Native Docker 対応）
 *
 * 問題：Next.js コンテナとブラウザでは Keycloak への到達経路が異なる
 *
 *   ブラウザ           → localhost:8080  （WSL2ポート転送経由）
 *   Next.jsコンテナ    → keycloak:8080   （Docker内部DNS）
 *
 * 解決策：KC_HOSTNAME_URL=http://localhost:8080 を Keycloak に設定することで、
 * Keycloak が返す全 URL（トークンの iss、Discovery Document の各 endpoint）が
 * localhost:8080 ベースになる。
 *
 * そのうえで NextAuth の各 endpoint を明示的に上書きし、
 * サーバーサイドの API 呼び出しには内部 URL (keycloak:8080) を使う。
 *
 *  issuer           = http://localhost:8080/...  ← KC_HOSTNAME_URL と一致。iss 検証に使用
 *  wellKnown        = http://keycloak:8080/...   ← Discovery Doc の取得（コンテナ内）
 *  authorization    = http://localhost:8080/...  ← ブラウザのリダイレクト先
 *  token/userinfo   = http://keycloak:8080/...   ← トークン取得・検証（コンテナ内）
 */

const issuer = process.env.KEYCLOAK_ISSUER!             // http://localhost:8080/realms/myrealm
const internalUrl = process.env.KEYCLOAK_INTERNAL_URL!  // http://keycloak:8080/realms/myrealm

export const authOptions: NextAuthOptions = {
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,

      // iss クレーム検証に使われる。KC_HOSTNAME_URL と一致させること。
      issuer,

      // Discovery Document の取得はコンテナ内部 URL から行う
      wellKnown: `${internalUrl}/.well-known/openid-configuration`,

      // ブラウザを localhost へリダイレクトする
      authorization: {
        url: `${issuer}/protocol/openid-connect/auth`,
        params: { scope: 'openid email profile' },
      },

      // 以下はサーバーサイドからの呼び出し → 内部 URL を使う
      token: `${internalUrl}/protocol/openid-connect/token`,
      userinfo: `${internalUrl}/protocol/openid-connect/userinfo`,
      jwks_endpoint: `${internalUrl}/protocol/openid-connect/certs`,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
        token.idToken = account.id_token
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      return session
    },
  },
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/',
  },
}
