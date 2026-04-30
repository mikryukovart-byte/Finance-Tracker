import { NextResponse } from "next/server";

import { badRequest, readJsonBody } from "@/lib/api";
import { isAuthError, requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { backupImportSchema, firstZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();

  if (isAuthError(auth)) {
    return auth;
  }

  const [categories, transactions, loans, loanPayments] = await Promise.all([
    prisma.category.findMany({
      where: { userId: auth.userId },
      orderBy: [{ type: "asc" }, { name: "asc" }]
    }),
    prisma.transaction.findMany({
      where: { userId: auth.userId },
      include: { category: true },
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
    })
  ]);

  return NextResponse.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
    transactions,
    loans,
    loanPayments
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
  const loanIdMap = new Map<string, string>();
  const transactionIdMap = new Map<string, string>();

  const result = await prisma.$transaction(async (tx) => {
    let importedCategories = 0;
    let importedTransactions = 0;
    let importedLoans = 0;
    let importedLoanPayments = 0;

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

    for (const loan of parsed.data.loans) {
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
        paymentDate: loan.paymentDate,
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

      const data = {
        amount: transaction.amount,
        type: transaction.type,
        date: transaction.date,
        description: transaction.description?.trim() || null,
        categoryId: category.id
      };

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
      transactions: importedTransactions,
      loans: importedLoans,
      loanPayments: importedLoanPayments
    };
  });

  return NextResponse.json({ ok: true, imported: result });
}
