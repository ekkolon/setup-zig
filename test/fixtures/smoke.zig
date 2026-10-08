const std = @import("std");

test "the installed compiler can run tests" {
    try std.testing.expectEqual(@as(u32, 42), 6 * 7);
}
