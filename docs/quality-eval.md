# Quality eval, 30 October 2026

The ten setup fixtures in `convex/evals/setupAnswers.ts`, each run on dev with a written playbook,
research and posts for the fixture's own networks:

```sh
npx convex run ai:researchEval '{"fixtureId": 1, "full": true, "write": true}'
```

| Fixture                | Stories | Cost   | Notes                                                                          |
| ---------------------- | ------- | ------ | ------------------------------------------------------------------------------ |
| 1 F1 news              | 4       | $0.063 | X posts, each credits its outlet                                               |
| 2 Good news            | 3       | $0.063 | LinkedIn drafts ran past the playbook's 900; a real run asks for a shorter one |
| 3 Security releases    | 4       | $0.069 | Bluesky and Mastodon, specific versions and CVEs                               |
| 4 Bristol food         | 4       | $0.057 | Threads and X, local and concrete                                              |
| 5 Rust HTTP            | 0       | $0.043 | Nothing new in the two-week window, correctly                                  |
| 6 Sheffield Wednesday  | 3       | $0.035 | Crashed on the first pass (reply cut off at 8,000 tokens)                      |
| 7 Kenyan conservation  | 2       | $0.046 | LinkedIn only                                                                  |
| 8 E-ink games          | 4       | $0.061 | X and Mastodon                                                                 |
| 9 B2B scheduling       | 2       | $0.053 | LinkedIn only                                                                  |
| 10 Cornish lighthouses | 0       | $0.050 | Nothing dated in the window, correctly                                         |

Average $0.054 and 53 seconds per research step, before writing.

## Fixed after the first pass

- Structured calls get 16,000 tokens instead of 8,000. Thinking counts against the limit, and one
  research reply was cut off mid-JSON, which failed the run.
- The research prompt says which tool takes a query and which takes a URL. On the first pass the
  model sent search queries as URLs and lost up to three of its four searches. On the second pass
  it lost at most two, and usually none.
- The eval writes for each fixture's own networks rather than always X and LinkedIn.

## Not fixable here

Some sites refuse Anthropic's fetcher (`url_not_allowed`), for example theguardian.com and
motorsport.com. Research falls back to search snippets and other outlets.
