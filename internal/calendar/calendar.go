// Package calendar answers "which academic term is it" in Asia/Seoul.
package calendar

import (
	"fmt"
	"time"
	_ "time/tzdata" // container images do not ship zoneinfo
)

// Semester codes follow the source timetable and are chronological within a year.
const (
	Spring = 1
	Summer = 2
	Fall   = 3
	Winter = 4
)

var seoul = mustLoad("Asia/Seoul")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// Location returns Asia/Seoul.
func Location() *time.Location { return seoul }

// Term is an academic term: a year and a semester code.
type Term struct {
	Year     int
	Semester int
}

// CurrentTerm maps a moment to its term in Seoul local time: March–June
// spring, July–August summer, September–December fall, and January–February
// the winter session of the previous year.
func CurrentTerm(t time.Time) Term {
	local := t.In(seoul)
	year, month := local.Year(), local.Month()
	switch {
	case month <= time.February:
		return Term{Year: year - 1, Semester: Winter}
	case month <= time.June:
		return Term{Year: year, Semester: Spring}
	case month <= time.August:
		return Term{Year: year, Semester: Summer}
	default:
		return Term{Year: year, Semester: Fall}
	}
}

var labels = map[int]string{Spring: "1학기", Summer: "여름학기", Fall: "2학기", Winter: "겨울학기"}

// SemesterLabel returns the Korean label shown to students.
func SemesterLabel(semester int) (string, error) {
	label, ok := labels[semester]
	if !ok {
		return "", fmt.Errorf("calendar: unknown semester %d", semester)
	}
	return label, nil
}

// Semesters lists every semester code in calendar order.
func Semesters() []int { return []int{Spring, Summer, Fall, Winter} }
