test "the installed compiler can run tests" {
    const answer: u32 = 6 * 7;
    if (answer != 42) unreachable;
}
