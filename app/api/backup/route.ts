import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import {
  ensureDefaultAccount,
  getCreditCardBalance,
  getTransactionImpact
} from "@/lib/accounts";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { backupImportSchema, firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const [categories, accounts, transactions, loans, loanPayments, transfers] = await Promise.all([
    prisma.category.findMany({
      where: { userId: auth.userId },
      orderBy: [{ type: "asc" }, { name: "asc" }]
    }),
    prisma.account.findMany({
      where: { userId: auth.userId },
      orderBy: [{ createdAt: "asc" }, { name: "asc" }]
    }),
    prisma.transaction.findMany({
      where: { userId: auth.userId },
      include: { category: true, account: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.loan.findMany({
      where: { userId: auth.userId },
      include: {
        payments: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }]
        }
      },
      orderBy: [{ status: "asc" }, { paymentDate: "asc" }]
    }),
    prisma.loanPayment.findMany({
      where: { userId: auth.userId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    }),
    prisma.transfer.findMany({
      where: { userId: auth.userId },
      include: { fromAccount: true, toAccount: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    })
  ]);

  return NextResponse.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
    accounts,
    transactions,
    loans,
    loanPayments,
    transfers
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const body = await readJsonBody(request);

  if (!body) {
    return badRequest("Выберите корректный JSON-файл");
  }

  const parsed = backupImportSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest(firstZodError(parsed.error));
  }

  const categoryIdMap = new Map<string, string>();
  const accountIdMap = new Map<string, string>();
  const loanIdMap = new Map<string, string>();
  const transactionIdMap = new Map<string, string>();

  const result = await prisma.$transaction(async (tx) => {
    let importedCategories = 0;
    let importedAccounts = 0;
    let importedTransactions = 0;
    let importedLoans = 0;
    let importedLoanPayments = 0;
    let importedTransfers = 0;

    for (const category of parsed.data.categories) {
      const normalizedName = category.name.trim().replace(/\s+/g, " ");
      const existingById = category.id
        ? await tx.category.findFirst({
            where: { id: category.id, userId: auth.userId }
          })
        : null;
      const sameTypeCategories = await tx.category.findMany({
        where: { userId: auth.userId, type: category.type }
      });
      const existing = sameTypeCategories.find(
        (item) =>
          item.id !== existingById?.id &&
          item.name.toLocaleLowerCase("ru-RU") ===
          normalizedName.toLocaleLowerCase("ru-RU")
      );

      const saved = existingById
        ? await tx.category.update({
            where: { id: existingById.id },
            data: { name: normalizedName, type: category.type }
          })
        : existing
        ? await tx.category.update({
            where: { id: existing.id },
            data: { name: normalizedName, type: category.type }
          })
        : await tx.category.create({
            data: {
              userId: auth.userId,
              name: normalizedName,
              type: category.type
            }
          });

      if (category.id) {
        categoryIdMap.set(category.id, saved.id);
      }

      importedCategories += 1;
    }

    for (const account of parsed.data.accounts ?? []) {
      const normalizedName = account.name.trim().replace(/\s+/g, " ");
      const accountType = account.type ?? "DEBIT";
      const currentDebt = accountType === "CREDIT_CARD" ? account.currentDebt ?? 0 : 0;
      const accountData = {
        type: accountType,
        balance:
          accountType === "CREDIT_CARD"
            ? getCreditCardBalance(currentDebt)
            : account.balance,
        currency: account.currency,
        creditLimit: accountType === "CREDIT_CARD" ? account.creditLimit ?? null : null,
        currentDebt,
        minimalPayment: accountType === "CREDIT_CARD" ? account.minimalPayment ?? null : null,
        paymentDate: accountType === "CREDIT_CARD" ? account.paymentDate ?? null : null
      };
      const existingById = account.id
        ? await tx.account.findFirst({
            where: { id: account.id, userId: auth.userId }
          })
        : null;
      const existingByName = await tx.account.findFirst({
        where: { userId: auth.userId, name: normalizedName }
      });
      const saved = existingById
        ? await tx.account.update({
            where: { id: existingById.id },
            data: {
              name: normalizedName,
              ...accountData
            }
          })
        : existingByName
          ? await tx.account.update({
              where: { id: existingByName.id },
              data: accountData
            })
          : await tx.account.create({
              data: {
                userId: auth.userId,
                name: normalizedName,
                ...accountData
              }
            });

      if (account.id) {
        accountIdMap.set(account.id, saved.id);
      }

      importedAccounts += 1;
    }

    const defaultAccount = await ensureDefaultAccount(auth.userId, tx);

    for (const loan of parsed.data.loans) {
      const mappedLoanAccountId = loan.accountId
        ? accountIdMap.get(loan.accountId) ?? loan.accountId
        : null;
      const loanAccount = mappedLoanAccountId
        ? await tx.account.findFirst({
            where: { id: mappedLoanAccountId, userId: auth.userId }
          })
        : null;
      const data = {
        debtType: loan.debtType,
        title: loan.title.trim().replace(/\s+/g, " "),
        lender: loan.lender?.trim().replace(/\s+/g, " ") || null,
        initialAmount: loan.initialAmount ?? null,
        remainingAmount:
          loan.initialAmount && loan.debtType !== "CREDIT_CARD"
            ? Math.min(loan.remainingAmount, loan.initialAmount)
            : loan.remainingAmount,
        monthlyPayment: loan.monthlyPayment,
        plannedPayment: loan.plannedPayment ?? loan.monthlyPayment ?? null,
        minimalPayment: loan.minimalPayment ?? null,
        creditLimit: loan.creditLimit ?? null,
        interestRate: loan.interestRate,
        gracePeriodDays: loan.gracePeriodDays ?? null,
        paymentDate: loan.paymentDate,
        accountId: loanAccount?.id ?? null,
        priority: loan.priority,
        status: loan.status
      };

      const existingLoan = loan.id
        ? await tx.loan.findFirst({ where: { id: loan.id, userId: auth.userId } })
        : null;

      const savedLoan = existingLoan
        ? await tx.loan.update({
          where: { id: existingLoan.id },
          data
        })
        : await tx.loan.create({ data: { ...data, userId: auth.userId } });

      if (loan.id) {
        loanIdMap.set(loan.id, savedLoan.id);
      }

      importedLoans += 1;
    }

    for (const transaction of parsed.data.transactions) {
      let categoryId: string | null = null;

      if (transaction.type !== "ADJUSTMENT") {
        if (!transaction.categoryId) {
          continue;
        }

        const mappedCategoryId =
          categoryIdMap.get(transaction.categoryId) ?? transaction.categoryId;
        const category = await tx.category.findFirst({
          where: {
            userId: auth.userId,
            id: mappedCategoryId,
            type: transaction.type
          }
        });

        if (!category) {
          continue;
        }

        categoryId = category.id;
      }

      const data = {
        amount: transaction.amount,
        type: transaction.type,
        date: transaction.date,
        description: transaction.description?.trim() || null,
        categoryId,
        accountId: transaction.accountId
          ? accountIdMap.get(transaction.accountId) ?? transaction.accountId
          : defaultAccount.id
      };
      const account = await tx.account.findFirst({
        where: { id: data.accountId, userId: auth.userId }
      });

      if (!account) {
        data.accountId = defaultAccount.id;
      }

      const existingTransaction = transaction.id
        ? await tx.transaction.findFirst({
            where: { id: transaction.id, userId: auth.userId }
          })
        : null;

      const savedTransaction = existingTransaction
        ? await tx.transaction.update({
          where: { id: existingTransaction.id },
          data
        })
        : await tx.transaction.create({ data: { ...data, userId: auth.userId } });

      if (transaction.id) {
        transactionIdMap.set(transaction.id, savedTransaction.id);
      }

      importedTransactions += 1;
    }

    if (!parsed.data.accounts?.length) {
      const importedBalance = await tx.transaction.findMany({
        where: { userId: auth.userId, accountId: defaultAccount.id }
      });
      await tx.account.update({
        where: { id: defaultAccount.id },
        data: {
          balance: importedBalance.reduce(
            (sum, transaction) =>
              sum + getTransactionImpact(transaction.type, transaction.amount),
            0
          )
        }
      });
    }

    for (const transfer of parsed.data.transfers ?? []) {
      const fromAccountId =
        accountIdMap.get(transfer.fromAccountId) ?? transfer.fromAccountId;
      const toAccountId = accountIdMap.get(transfer.toAccountId) ?? transfer.toAccountId;
      const [fromAccount, toAccount] = await Promise.all([
        tx.account.findFirst({ where: { id: fromAccountId, userId: auth.userId } }),
        tx.account.findFirst({ where: { id: toAccountId, userId: auth.userId } })
      ]);

      if (!fromAccount || !toAccount || fromAccount.id === toAccount.id) {
        continue;
      }

      const data = {
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        amount: transfer.amount,
        date: transfer.date,
        description: transfer.description?.trim() || null
      };
      const existingTransfer = transfer.id
        ? await tx.transfer.findFirst({ where: { id: transfer.id, userId: auth.userId } })
        : null;

      if (existingTransfer) {
        await tx.transfer.update({
          where: { id: existingTransfer.id },
          data
        });
      } else {
        await tx.transfer.create({ data: { ...data, userId: auth.userId } });
      }

      importedTransfers += 1;
    }

    for (const payment of parsed.data.loanPayments ?? []) {
      const loanId = loanIdMap.get(payment.loanId) ?? payment.loanId;
      const loan = await tx.loan.findFirst({
        where: { id: loanId, userId: auth.userId }
      });

      if (!loan) {
        continue;
      }

      const transactionId = payment.transactionId
        ? transactionIdMap.get(payment.transactionId) ?? payment.transactionId
        : null;
      const transaction = transactionId
        ? await tx.transaction.findFirst({
            where: { id: transactionId, userId: auth.userId }
          })
        : null;
      const data = {
        loanId: loan.id,
        amount: payment.amount,
        appliedAmount: payment.appliedAmount ?? payment.amount,
        date: payment.date,
        description: payment.description?.trim() || null,
        transactionId: transaction?.id ?? null
      };
      const existingPayment = payment.id
        ? await tx.loanPayment.findFirst({
            where: { id: payment.id, userId: auth.userId }
          })
        : null;

      if (existingPayment) {
        await tx.loanPayment.update({
          where: { id: existingPayment.id },
          data
        });
      } else {
        await tx.loanPayment.create({ data: { ...data, userId: auth.userId } });
      }

      importedLoanPayments += 1;
    }

    return {
      categories: importedCategories,
      accounts: importedAccounts,
      transactions: importedTransactions,
      loans: importedLoans,
      loanPayments: importedLoanPayments,
      transfers: importedTransfers
    };
  });

  return NextResponse.json({ ok: true, imported: result });
}
