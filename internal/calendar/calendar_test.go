package calendar_test

import (
	"testing"
	"time"

	"github.com/snuarchive/snuarchive/internal/calendar"
)

func TestCurrentTerm(t *testing.T) {
	seoul := calendar.Location()
	cases := []struct {
		name string
		at   time.Time
		want calendar.Term
	}{
		{"new year is previous winter", time.Date(2026, 1, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2025, Semester: calendar.Winter}},
		{"last minute of february", time.Date(2026, 2, 28, 23, 59, 0, 0, seoul), calendar.Term{Year: 2025, Semester: calendar.Winter}},
		{"march starts spring", time.Date(2026, 3, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Spring}},
		{"seoul midnight is still february in UTC", time.Date(2026, 2, 28, 15, 30, 0, 0, time.UTC), calendar.Term{Year: 2026, Semester: calendar.Spring}},
		{"june is spring", time.Date(2026, 6, 30, 12, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Spring}},
		{"july is summer", time.Date(2026, 7, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Summer}},
		{"august is summer", time.Date(2026, 8, 31, 23, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Summer}},
		{"september is fall", time.Date(2026, 9, 1, 0, 0, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Fall}},
		{"december is fall", time.Date(2026, 12, 31, 23, 59, 0, 0, seoul), calendar.Term{Year: 2026, Semester: calendar.Fall}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := calendar.CurrentTerm(tc.at); got != tc.want {
				t.Fatalf("CurrentTerm(%s) = %+v, want %+v", tc.at, got, tc.want)
			}
		})
	}
}

func TestSemesterLabel(t *testing.T) {
	want := map[int]string{1: "1학기", 2: "여름학기", 3: "2학기", 4: "겨울학기"}
	for _, s := range calendar.Semesters() {
		got, err := calendar.SemesterLabel(s)
		if err != nil || got != want[s] {
			t.Fatalf("SemesterLabel(%d) = %q, %v; want %q", s, got, err, want[s])
		}
	}
	if _, err := calendar.SemesterLabel(5); err == nil {
		t.Fatal("SemesterLabel(5) should fail")
	}
}

func TestSemestersAreCalendarOrder(t *testing.T) {
	got := calendar.Semesters()
	want := []int{calendar.Spring, calendar.Summer, calendar.Fall, calendar.Winter}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Semesters() = %v, want %v", got, want)
		}
	}
}
