import { fixupConfigRules } from "@eslint/compat";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

// Household rows and operations are read and written only through the
// data-access layer in src/server/storage (ADR 0006), which leaves out
// deleted rows and writes change sets with the household revision.
const rowModels = [
  "Member",
  "BudgetSettings",
  "Account",
  "CategoryGroup",
  "Category",
  "Target",
  "Assignment",
  "ExpectedIncome",
  "Transaction",
  "TransactionShare",
  "TransactionHistory",
  "Loan",
  "LoanRate",
  "LoanPayment",
  "Reimbursement",
  "ReimbursementReceipt",
  "Rule",
  "BankImport",
  "SharedCategory",
  "Obligation",
  "Settlement",
  "SettlementAllocation",
  "PartnerFact",
  "Operation",
];
const rowAccessors = new Set(
  rowModels.map((model) => model.charAt(0).toLowerCase() + model.slice(1)),
);
const rowTableInSql = new RegExp(`"(${rowModels.join("|")})"`);
/** @type {import("eslint").Rule.RuleModule} */
const rowAccess = {
  meta: {
    type: "problem",
    messages: {
      model:
        "Read and write {{name}} through src/server/storage, never with Prisma directly (ADR 0006).",
      sql: "Read and write household rows through src/server/storage, never with raw SQL (ADR 0006).",
    },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    const checker = services.program.getTypeChecker();
    /** @param {import("estree").Node} node */
    const isPrismaClient = (node) =>
      checker
        .getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node))
        .getProperty("$queryRaw") !== undefined;
    /** @param {import("estree").Node} node */
    const sqlText = (node) =>
      node.type === "TemplateLiteral"
        ? node.quasis.map((quasi) => quasi.value.raw).join("")
        : node.type === "Literal" && typeof node.value === "string"
          ? node.value
          : "";
    return {
      MemberExpression(node) {
        const name =
          node.property.type === "Identifier" && !node.computed
            ? node.property.name
            : node.property.type === "Literal" &&
                typeof node.property.value === "string"
              ? node.property.value
              : "";
        if (rowAccessors.has(name) && isPrismaClient(node.object))
          context.report({ node, messageId: "model", data: { name } });
      },
      TaggedTemplateExpression(node) {
        if (rowTableInSql.test(sqlText(node.quasi)))
          context.report({ node, messageId: "sql" });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          /^\$(query|execute)Raw/.test(callee.property.name) &&
          node.arguments.some((argument) =>
            rowTableInSql.test(sqlText(argument)),
          )
        )
          context.report({ node, messageId: "sql" });
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [".next", "src/generated", "next-env.d.ts"],
  },
  ...fixupConfigRules(compat.extends("next/core-web-vitals")),
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["src/server/storage/**"],
    plugins: { caishen: { rules: { "row-access": rowAccess } } },
    rules: { "caishen/row-access": "error" },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
