// PayPal Payment Email Parser
// Extracts transaction ID + amount from PayPal payment notification emails
// Supports EN + VI variants, Bright Data and generic PayPal payments

export interface PaymentParseResult {
  isPayment: boolean;
  amount?: number;        // exact amount from email
  amountRaw?: string;     // raw string before normalization
  transactionId?: string;
  confidence: number;     // 0..1
  matchedPatterns: string[];
}

// ─── Amount patterns ───

// PayPal amount formats: $3,684.94 / 3.684,94 / 3684.94 / US$50.00
const AMOUNT_PATTERNS = [
  // "$3,684.94" or "US$50.00" or "USD 3,684.94"
  /(?:US?\$|USD)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/,
  // "$3684.94"
  /(?:US?\$|USD)\s*([0-9]+\.[0-9]{2})/,
  // "3,684.94 USD" or "3684.94 USD"
  /([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*(?:USD|US\$|\$)/,
  // "3.684,94 USD" (EU/VN format)
  /([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})\s*(?:USD|US\$|\$)/,
  // Generic: "You received $50.00" / "Bạn đã nhận $50.00"
  /(?:received|nhận|sent|gửi|payment of)\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2}))/i,
];

// ─── Transaction ID patterns ───

const TXID_PATTERNS = [
  // Explicit labels
  /(?:Transaction ID|Mã giao dịch|Transaction number|Reference|Ref)[:\s]+([A-Z0-9]{10,20})/i,
  // PayPal style: 17-char alphanumeric
  /\b([0-9A-Z]{17})\b/,
  // Slightly shorter PayPal IDs
  /\b([0-9A-Z]{13,20})\b/,
];

// False positive TX ID filters
function isValidTxId(txId: string): boolean {
  if (!txId || txId.length < 10) return false;
  // Reject pure years
  if (/^(19|20)\d{2}$/.test(txId)) return false;
  // Reject all same digit
  if (/^(.)\1+$/.test(txId)) return false;
  // Reject pure numeric short
  if (/^\d+$/.test(txId) && txId.length < 13) return false;
  // Must have mix of letters+digits for PayPal style
  if (txId.length >= 15 && /^[0-9]+$/.test(txId)) return false;
  return true;
}

// ─── Payment detection patterns ───

const PAYMENT_SENDER_PATTERNS = [
  /paypal\.com$/i,
  /paypal@/i,
];

const PAYMENT_CONTENT_PATTERNS = [
  // EN
  /you('ve| have)?\s*(received|got)\s*(a\s+)?payment/i,
  /payment\s*(of|from|received)/i,
  /sent you\s+\$/i,
  /money\s*(received|sent)/i,
  /bright\s*data/i,
  // VI
  /bạn\s*đã\s*nhận/i,
  /thanh toán/i,
  /đã\s*gửi\s*cho\s*bạn/i,
  /nhận\s*được\s*tiền/i,
  /khoản\s*thanh\s*toán/i,
];

// Non-payment patterns (verification, security, etc.)
const NON_PAYMENT_PATTERNS = [
  /verify\s*your/i,
  /xác\s*minh/i,
  /confirm\s*your\s*(email|identity|account)/i,
  /security\s*(code|alert)/i,
  /password/i,
  /login\s*attempt/i,
  /suspicious/i,
  /limited/i,
  /suspended/i,
  /deactivated/i,
];

// ─── Normalize amount string ───

function normalizeAmount(raw: string): number | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]/g, ""); // strip whitespace + zero-width

  // EU/VN format: 3.684,94 → 3684.94
  if (/^\d{1,3}(\.\d{3})+(,\d{2})$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // US format: 3,684.94 → 3684.94
  else if (/^\d{1,3}(,\d{3})+(\.\d{2})$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");
  }
  // Simple: 3684.94
  else {
    cleaned = cleaned.replace(/,/g, "");
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Main parser ───

export function parsePayPalPaymentEmail(input: {
  subject: string;
  bodyText: string;
  senderEmail: string;
}): PaymentParseResult {
  const { subject, bodyText, senderEmail } = input;
  const fullText = `${subject}\n${bodyText}`;
  const matched: string[] = [];

  // Step 1: Check sender
  const isPayPalSender = PAYMENT_SENDER_PATTERNS.some((p) => p.test(senderEmail));
  if (isPayPalSender) matched.push("paypal_sender");

  // Step 2: Check content for payment signals
  let paymentSignals = 0;
  for (const p of PAYMENT_CONTENT_PATTERNS) {
    if (p.test(fullText)) {
      paymentSignals++;
      matched.push(p.source.slice(0, 30));
    }
  }

  // Step 3: Check for non-payment
  let isNonPayment = false;
  for (const p of NON_PAYMENT_PATTERNS) {
    if (p.test(fullText)) {
      isNonPayment = true;
      break;
    }
  }

  // Step 4: Determine if this is a payment email
  const isPayment = isPayPalSender && paymentSignals >= 1 && !isNonPayment;
  if (!isPayment) {
    return { isPayment: false, confidence: 0, matchedPatterns: matched };
  }

  // Step 5: Extract amount
  let amount: number | null = null;
  let amountRaw: string | undefined;

  for (const p of AMOUNT_PATTERNS) {
    const match = fullText.match(p);
    if (match && match[1]) {
      amountRaw = match[1];
      amount = normalizeAmount(match[1]);
      if (amount !== null && amount > 0) {
        matched.push(`amount:${amountRaw}`);
        break;
      }
    }
  }

  // Step 6: Extract transaction ID
  let transactionId: string | undefined;

  for (const p of TXID_PATTERNS) {
    const match = fullText.match(p);
    if (match && match[1] && isValidTxId(match[1])) {
      transactionId = match[1];
      matched.push(`txid:${transactionId}`);
      break;
    }
  }

  // Step 7: Calculate confidence
  let confidence = 0.3; // base: sender is PayPal
  if (paymentSignals >= 2) confidence += 0.2;
  if (amount !== null) confidence += 0.3;
  if (transactionId) confidence += 0.2;
  confidence = Math.min(1, confidence);

  return {
    isPayment: true,
    amount: amount ?? undefined,
    amountRaw,
    transactionId,
    confidence,
    matchedPatterns: matched,
  };
}

// ─── Match helper: find best payment email for a fund amount ───

export function findMatchingPayment(
  emails: Array<{ subject: string; bodyText: string; senderEmail: string; receivedAt: string }>,
  targetAmount: number,
  afterDate: Date,
  tolerance: number = 0.50, // default $0.50 tolerance
): PaymentParseResult & { emailDate?: string } | null {
  const candidates: Array<PaymentParseResult & { emailDate: string; amountDiff: number }> = [];

  for (const email of emails) {
    // Only check emails after the fund date
    const emailDate = new Date(email.receivedAt);
    if (emailDate < afterDate) continue;

    const result = parsePayPalPaymentEmail(email);
    if (!result.isPayment || result.amount === undefined) continue;

    const diff = Math.abs(result.amount - targetAmount);
    if (diff <= tolerance) {
      candidates.push({ ...result, emailDate: email.receivedAt, amountDiff: diff });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by: smallest amount difference first, then highest confidence
  candidates.sort((a, b) => a.amountDiff - b.amountDiff || b.confidence - a.confidence);
  return candidates[0];
}
