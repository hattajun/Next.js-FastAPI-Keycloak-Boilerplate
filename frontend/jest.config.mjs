import nextJest from 'next/jest.js'

/**
 * next/jest を使うことで以下が自動設定される:
 *   - TypeScript のトランスパイル（SWC）
 *   - パスエイリアス（@/）の解決
 *   - next/font / CSS Modules のモック
 *   - .env.local の読み込み
 */
const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const config = {
  // lib/fetch.ts は DOM を使わない純粋な関数のため node 環境で十分
  // React コンポーネントのテストを追加する場合は jsdom に変更する
  testEnvironment: 'node',

  // テストファイルの場所
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],

  // カバレッジ対象（src/lib/ のみ — Phase 2 の対象範囲）
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/**/*.d.ts',
  ],

  // カバレッジのしきい値（コントリビューターへの指針）
  coverageThreshold: {
    global: {
      lines:     80,
      functions: 80,
      branches:  70,
    },
  },
}

export default createJestConfig(config)
