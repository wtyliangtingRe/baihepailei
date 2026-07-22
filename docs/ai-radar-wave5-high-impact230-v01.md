# Wave 5 High-Impact 230 Input v01

This runner installs and verifies the fixed high-impact research package selected after the verified priority-35 result set.

## Fixed package

```text
Package: RADAR-WAVE5-HIGH-IMPACT-230-input-v01.zip
SHA-256: 323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3
Rows: 230
Chunks: 46
```

## Grade distribution

```text
S: 1
A: 122
E: 99
F: 8
```

The batch contains every remaining Wave 5 row whose previous grade is S, A, E, or F. It excludes all 35 identities already processed by the verified priority-35 package.

## Source binding

```text
Wave 5 input ZIP:
9d0f9f6002681b3851d1aaa3da9970af03396d222cfc1015cf4ee42f9e2c9be3

Wave 5 input checkpoint:
c3c0f21cfe3a3c3c2f10a4d0393d8ecf5c0a79b1c0a3f04c85a97ab6f84c7f76

Priority-35 result ZIP:
a09702bb94367ad3149b1b976309e70aef54e9ee2d3f245dbcfb77c1f089550f

Priority-35 result checkpoint:
ea126e8039a7879ddd38e05de5ff4edb369395407ed9849c61f5744743b6a224
```

## Validation

The Windows runner verifies:

- the outer ZIP SHA-256;
- every nested file hash;
- exact S/A/E/F counts;
- all 230 unique identities;
- zero overlap with the completed priority-35 batch;
- every five-row chunk;
- exact equality between aggregate and chunk identity sets;
- row-level `do_not_publish` and human-review guards.

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- All artifacts remain under `data_local`.

The PR must stay draft until the Windows input checkpoint is uploaded and verified.
