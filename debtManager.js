import { deleteField, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const FINE_DAILY_INTEREST_RATE = 0.01;
const ADMIN_PARTIAL_PAYMENT_FEE_RATE = 0.05;
const ADMIN_LATE_PAYMENT_FEE_RATE = 0.05;

function asNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function debtRemaining(item) {
  return asNumber(item?.remaining ?? item?.amount ?? 0);
}

function hasBlutzsInsurance(userData = {}) {
  return userData.insurance?.activePackages?.includes("blutzs_a");
}

function getJudicialFineCoverageRate(userData = {}) {
  return hasBlutzsInsurance(userData) ? 0.5 : 0;
}

function getCoveredFineAmounts(originalAmount, coverageRate, remainingDueOverride = null) {
  const original = asNumber(originalAmount);
  const rate = Math.max(0, Math.min(1, Number(coverageRate || 0)));
  const coveredCap = Math.max(0, original - 1);
  const covered = rate > 0 ? Math.min(coveredCap, Math.ceil(original * rate)) : 0;
  const due = remainingDueOverride != null ? Math.max(0, asNumber(remainingDueOverride)) : Math.max(0, original - covered);

  return {
    original,
    covered,
    due,
    rate
  };
}

function getOrderedAdminDebts(data = {}) {
  return Object.entries(data.adminDebts || {})
    .map(([id, debt]) => [id, {
      ...debt,
      id,
      type: debt.type || "admin",
      amount: asNumber(debt.amount),
      remaining: debtRemaining(debt),
      issuedAt: debt.issuedAt || null,
      dueDate: debt.dueDate || null,
      status: debt.status || "open"
    }])
    .filter(([, debt]) => debt.remaining > 0)
    .sort((a, b) => {
      const aDue = asDate(a[1].dueDate)?.getTime();
      const bDue = asDate(b[1].dueDate)?.getTime();

      if (aDue !== bDue) {
        return (aDue ?? Number.POSITIVE_INFINITY) - (bDue ?? Number.POSITIVE_INFINITY);
      }

      return (asDate(a[1].issuedAt)?.getTime() || 0) - (asDate(b[1].issuedAt)?.getTime() || 0);
    })
    .map(([, debt]) => debt);
}

function getFeeAmount(amount, rate) {
  return amount > 0 ? Math.max(1, Math.ceil(amount * rate)) : 0;
}

export function buildAdminDebtRecord({ amount, reason, issuedAt = new Date().toISOString(), dueDate, createdBy = null }) {
  const id = `admin_debt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  return {
    id,
    type: "admin",
    amount: asNumber(amount),
    remaining: asNumber(amount),
    reason: reason || "Unpaid item debt",
    issuedAt,
    dueDate: dueDate || new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
    lastInterestDate: null,
    createdBy,
    status: "open"
  };
}

export function getDebtLedger(data = {}) {
  const fineCoverageRate = getJudicialFineCoverageRate(data);
  const fineAmounts = data.activeFine
    ? getCoveredFineAmounts(
        data.activeFine.amount,
        data.activeFine.insuranceCoverageRate ?? fineCoverageRate,
        data.activeFine.remainingDue ?? null
      )
    : { original: 0, covered: 0, due: 0, rate: 0 };

  const fineDebt = data.activeFine ? {
    type: "fine",
    amount: fineAmounts.due,
    originalAmount: fineAmounts.original,
    coveredAmount: fineAmounts.covered,
    insuranceCoverageRate: fineAmounts.rate,
    insuranceActive: fineAmounts.covered > 0,
    remainingDue: fineAmounts.due,
    reason: data.activeFine.reason || "Judicial fine",
    issuedAt: data.activeFine.issuedAt || null,
    dueDate: data.activeFine.dueDate || null,
    lastInterestDate: data.activeFine.lastInterestDate || null,
    appealPending: Boolean(data.activeFine.appealPending),
    appealStatus: data.activeFine.appealStatus || "none",
    appealReason: data.activeFine.appealReason || ""
  } : null;

  const adminDebts = Object.values(data.adminDebts || {})
    .map((debt) => ({
      ...debt,
      type: debt.type || "admin",
      amount: asNumber(debt.amount),
      remaining: debtRemaining(debt),
      issuedAt: debt.issuedAt || null,
      dueDate: debt.dueDate || null,
      status: debt.status || "open"
    }))
    .filter((debt) => debt.remaining > 0)
    .sort((a, b) => {
      const aDue = asDate(a.dueDate)?.getTime();
      const bDue = asDate(b.dueDate)?.getTime();

      if (aDue !== bDue) {
        return (aDue ?? Number.POSITIVE_INFINITY) - (bDue ?? Number.POSITIVE_INFINITY);
      }

      return (asDate(a.issuedAt)?.getTime() || 0) - (asDate(b.issuedAt)?.getTime() || 0);
    });

  const fineTotal = fineDebt ? fineDebt.amount : 0;
  const fineOriginalTotal = fineDebt ? fineDebt.originalAmount : 0;
  const fineCoveredTotal = fineDebt ? fineDebt.coveredAmount : 0;
  const adminTotal = adminDebts.reduce((sum, debt) => sum + debt.remaining, 0);
  const loanTotal = asNumber(data.activeLoan);
  const totalDebt = fineTotal + adminTotal;
  const globalDebt = totalDebt + loanTotal;

  return {
    fineDebt,
    adminDebts,
    fineTotal,
    fineOriginalTotal,
    fineCoveredTotal,
    adminTotal,
    loanTotal,
    totalDebt,
    globalDebt,
    hasDebt: globalDebt > 0
  };
}

export async function applyFineInterestIfNeeded(userRef, userData, now = new Date()) {
  const fine = userData?.activeFine;
  if (!fine || !fine.dueDate) return false;

  const dueDate = asDate(fine.dueDate);
  if (!dueDate || now <= dueDate) return false;

  const lastInterestDate = asDate(fine.lastInterestDate) || dueDate;
  const elapsedHours = (now.getTime() - lastInterestDate.getTime()) / (1000 * 60 * 60);
  if (elapsedHours < 24) return false;

  const newAmount = Math.ceil(asNumber(fine.amount) * (1 + FINE_DAILY_INTEREST_RATE));
  await updateDoc(userRef, {
    "activeFine.remainingDue": newAmount,
    "activeFine.lastInterestDate": now.toISOString()
  });

  return true;
}

export function buildDebtPaymentPreview(userData = {}, requestedAmount, now = new Date()) {
  const paymentTarget = asNumber(requestedAmount);
  if (paymentTarget <= 0) {
    throw new Error("Enter a valid debt payment amount.");
  }

  const ledger = getDebtLedger(userData);
  const paymentAmount = Math.min(paymentTarget, ledger.totalDebt);

  if (paymentAmount <= 0) {
    throw new Error("No payable debt found.");
  }

  const breakdown = [];
  let remainingPayment = paymentAmount;
  let finePaid = 0;
  let adminPaid = 0;
  let adminPartialFee = 0;
  let adminLateFee = 0;

  if (ledger.fineDebt && remainingPayment > 0) {
    const finePayment = Math.min(remainingPayment, ledger.fineTotal);
    if (finePayment > 0) {
      finePaid = finePayment;
      breakdown.push({
        type: "fine",
        amount: finePayment,
        originalAmount: ledger.fineDebt.originalAmount,
        coveredAmount: ledger.fineDebt.coveredAmount,
        insuranceActive: ledger.fineDebt.insuranceActive,
        fee: 0,
        lateFee: 0,
        reason: ledger.fineDebt.reason || "Judicial fine"
      });
      remainingPayment -= finePayment;
    }
  }

  for (const debt of getOrderedAdminDebts(userData)) {
    if (remainingPayment <= 0) break;

    const debtPayment = Math.min(remainingPayment, debt.remaining);
    if (debtPayment <= 0) continue;

    const nextRemaining = debt.remaining - debtPayment;
    const dueDate = asDate(debt.dueDate);
    const overdue = dueDate ? now > dueDate : false;
    const partialFee = nextRemaining > 0 ? getFeeAmount(debtPayment, ADMIN_PARTIAL_PAYMENT_FEE_RATE) : 0;
    const lateFee = overdue ? getFeeAmount(debtPayment, ADMIN_LATE_PAYMENT_FEE_RATE) : 0;

    adminPaid += debtPayment;
    adminPartialFee += partialFee;
    adminLateFee += lateFee;
    breakdown.push({
      type: "admin",
      id: debt.id,
      amount: debtPayment,
      fee: partialFee,
      lateFee,
      reason: debt.reason || "Admin-issued debt",
      dueDate: debt.dueDate || null,
      overdue
    });

    remainingPayment -= debtPayment;
  }

  return {
    paymentTarget,
    paymentAmount,
    finePaid,
    adminPaid,
    adminPartialFee,
    adminLateFee,
    totalFee: adminPartialFee + adminLateFee,
    balanceCost: paymentAmount + adminPartialFee + adminLateFee,
    fullDebtCovered: paymentAmount >= ledger.totalDebt,
    breakdown,
    ledger
  };
}

export async function payDebtChunk(userRef, userData, requestedAmount) {
  const preview = buildDebtPaymentPreview(userData, requestedAmount);
  const { paymentAmount, finePaid, adminPaid, adminPartialFee, adminLateFee, balanceCost } = preview;

  if (asNumber(userData.balance) < balanceCost) {
    throw new Error(`Insufficient cash. Need $${balanceCost.toLocaleString()} to cover the payment and fees.`);
  }

  const updates = {
    balance: asNumber(userData.balance) - balanceCost
  };

  if (userData.activeFine && finePaid > 0) {
    const fineRemaining = asNumber(preview.ledger.fineTotal);
    const newFineAmount = fineRemaining - finePaid;

    if (newFineAmount <= 0) {
      updates.activeFine = null;
    } else {
      updates["activeFine.remainingDue"] = newFineAmount;
    }
  }

  let remainingPayment = adminPaid;
  const adminDebtEntries = Object.entries(userData.adminDebts || {})
    .map(([id, debt]) => [id, { ...debt, remaining: debtRemaining(debt) }])
    .sort((a, b) => {
      const aDue = asDate(a[1].dueDate)?.getTime();
      const bDue = asDate(b[1].dueDate)?.getTime();

      if (aDue !== bDue) {
        return (aDue ?? Number.POSITIVE_INFINITY) - (bDue ?? Number.POSITIVE_INFINITY);
      }

      return (asDate(a[1].issuedAt)?.getTime() || 0) - (asDate(b[1].issuedAt)?.getTime() || 0);
    });

  for (const [id, debt] of adminDebtEntries) {
    if (remainingPayment <= 0) break;

    const debtPayment = Math.min(remainingPayment, debt.remaining);
    const nextRemaining = debt.remaining - debtPayment;
    remainingPayment -= debtPayment;

    if (nextRemaining <= 0) {
      updates[`adminDebts.${id}`] = deleteField();
    } else {
      updates[`adminDebts.${id}.remaining`] = nextRemaining;
      updates[`adminDebts.${id}.status`] = "open";
    }
  }

  await updateDoc(userRef, updates);

  return {
    paid: paymentAmount,
    finePaid,
    fineOriginalPaid: preview.ledger.fineDebt?.originalAmount || 0,
    fineCoveredPaid: preview.ledger.fineDebt?.coveredAmount || 0,
    adminPaid,
    adminPartialFee,
    adminLateFee,
    penalty: adminPartialFee + adminLateFee,
    balanceCost,
    remainingDebt: Math.max(0, preview.ledger.totalDebt - paymentAmount)
  };
}

export function formatDebtStatus(debt) {
  if (!debt) return "Clear";
  const dueDate = asDate(debt.dueDate);
  const isOverdue = dueDate ? new Date() > dueDate : false;
  return isOverdue ? "Overdue" : "Open";
}
