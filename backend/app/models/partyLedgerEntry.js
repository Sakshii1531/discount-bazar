import mongoose from "mongoose";

// One ledger for both customers and suppliers. `amount` is always positive;
// `effect` says whether it raises (+) or lowers (-) what the party owes/is owed:
//   customer: SALE(+ credit given) / PAYMENT(-) / SALE_RETURN(-)
//   supplier: PURCHASE(+ payable) / PAYMENT(-) / PURCHASE_RETURN(-)
const partyLedgerEntrySchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    partyType: { type: String, enum: ["CUSTOMER", "SUPPLIER"], required: true },
    party: { type: mongoose.Schema.Types.ObjectId, required: true },
    kind: {
      type: String,
      enum: ["SALE", "SALE_RETURN", "PURCHASE", "PURCHASE_RETURN", "PAYMENT"],
      required: true,
    },
    effect: { type: Number, enum: [1, -1], required: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ["CASH", "CARD", "UPI", "OTHER", ""], default: "" },
    refModel: { type: String, default: "" },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    refNo: { type: String, default: "" },
    note: { type: String, trim: true, default: "" },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

partyLedgerEntrySchema.index({ seller: 1, partyType: 1, party: 1, date: -1 });
partyLedgerEntrySchema.index({ seller: 1, refModel: 1, refId: 1 });
partyLedgerEntrySchema.index({ seller: 1, kind: 1, date: -1 });

export default mongoose.model("PartyLedgerEntry", partyLedgerEntrySchema);
