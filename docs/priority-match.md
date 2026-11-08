# Premium Matches

Premium users get an immediate, one-sided match when they like a profile. The match is stored for and displayed only to the Premium user; the other person does not receive a match notification or see a match.

Regular users keep the existing reciprocal-like flow. If the other person later likes the Premium user back, the one-sided Premium match is upgraded to a regular mutual match and becomes visible to both users.

## Enable Premium

This repository does not currently include subscription billing or payment verification. Premium is therefore an operator-managed entitlement.

After applying migrations, an operator can enable Premium for a Telegram user ID in the Cloudflare D1 database:

```sql
UPDATE users SET is_premium = 1 WHERE id = <TELEGRAM_USER_ID>;
```

To revoke it:

```sql
UPDATE users SET is_premium = 0 WHERE id = <TELEGRAM_USER_ID>;
```

Apply database migrations with the project's normal D1 migration procedure before deploying the code.
