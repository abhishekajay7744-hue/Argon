# Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership**: Every document in `/users/{userId}` and its subcollections (`transactions`, `bills`, `budgets`) belongs exclusively to the verified user whose `request.auth.uid == userId` and `data.userId == request.auth.uid`.
2. **Email Verification**: All reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Immutable Ownership & Creation Time**: `userId` and `createdAt` cannot be modified after creation.
4. **Server-Side Temporal Integrity**: `createdAt` on create and `updatedAt` on update must equal `request.time`.
5. **Terminal State Locking on Paid Bills**: Once a `Bill` reaches `status == 'paid'`, it cannot be mutated further via client update.
6. **Bounded Strings & Positive Amounts**: All amounts (`amount`, `monthlyLimit`) must be numbers `> 0` and `<= 100000000`; all strings have strict `size()` limits and regex guards on dates (`YYYY-MM-DD`), times (`HH:mm`), and document IDs (`^[a-zA-Z0-9_\\-]+$`).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Cross-User Read**: User B attempts `get` on `/users/userA/transactions/tx1`.
2. **Cross-User List**: User B attempts `list` on `/users/userA/transactions`.
3. **Unverified Email Write**: User A with `email_verified: false` attempts to create a transaction.
4. **Identity Spoofing on Create**: User A creates `/users/userA/transactions/tx1` with `userId: "userB"`.
5. **Shadow Field Injection**: User A creates a transaction with extra field `isAdmin: true`.
6. **Negative Monetary Amount**: User A creates a transaction with `amount: -50`.
7. **Invalid Date Format**: User A creates a transaction with `date: "11/16/2026"` instead of `YYYY-MM-DD`.
8. **Resource Exhaustion (1MB String)**: User A sets `title` to a 5000-character string or `transactionId` to 200 characters.
9. **Client-Forged Timestamp**: User A creates a transaction with a hardcoded past `createdAt` instead of `request.time`.
10. **Immutable Field Mutation**: User A updates a transaction's `createdAt` or `userId`.
11. **Terminal State Bypass**: User A attempts to update a `Bill` whose existing `status` is `'paid'`.
12. **Unallowlisted Key Update**: User A updates a transaction using `affectedKeys` containing `sourceBillId` when editing details.
